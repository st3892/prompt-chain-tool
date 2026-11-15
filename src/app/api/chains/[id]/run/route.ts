import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { getDatabaseErrorMessage, getSuperadminClient } from "@/lib/supabase/admin";
import {
  escapeModelKeyForDiagnostics,
  normalizeGeminiModelKey,
} from "@/lib/gemini-model";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EXECUTION_TIME_MS = 270_000;
const MAX_MODEL_REQUEST_TIME_MS = 90_000;
const MAX_MODEL_ATTEMPTS = 3;

export const runtime = "nodejs";
export const maxDuration = 300;

type ChainStep = {
  id: number;
  step_order: number;
  name: string;
  prompt_template: string;
  llm_model_id: number;
  temperature: number | null;
};

type GeminiModel = {
  id: number;
  name: string;
  model_key: string;
  request_model_id: string;
  is_active: boolean;
  supports_temperature: boolean;
};

type RunEvent =
  | {
      type: "progress";
      step: number;
      total: number;
      name: string;
      generationRequestId: string;
    }
  | {
      type: "retry";
      step: number;
      name: string;
      attempt: number;
      maxAttempts: number;
      delayMs: number;
    }
  | { type: "step_result"; step: number; name: string; output: string }
  | { type: "complete" }
  | { type: "error"; message: string };

function isValidImageSignature(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    type === "image/webp" &&
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  );
}

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { status: 0, code: "", message: "Unknown Gemini error." };
  }
  const details = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
  };
  const rawStatus = details.status ?? details.code;
  return {
    status:
      typeof rawStatus === "number"
        ? rawStatus
        : typeof rawStatus === "string" && /^\d+$/.test(rawStatus)
          ? Number(rawStatus)
          : 0,
    code: typeof details.code === "string" ? details.code : "",
    message:
      typeof details.message === "string"
        ? details.message
        : "Gemini returned an error without additional details.",
  };
}

function getErrorCategory(error: unknown) {
  const details = getErrorDetails(error);
  if (details.status === 503 || details.status === 504) return "transient-service";
  if (details.status === 401 || details.status === 403) return "authentication";
  if (details.status === 429) return "quota";
  if (details.status === 404) return "model-not-found";
  if (details.status === 400) return "invalid-request";
  if (details.status) return "http-error";
  if (/abort|timeout/i.test(`${details.code} ${details.message}`)) {
    return "request-timeout";
  }
  return "unknown";
}

function isRetryableGeminiError(error: unknown) {
  const { status } = getErrorDetails(error);
  return status === 503 || status === 504;
}

function redactApiKey(message: string, apiKey: string) {
  return message
    .split(apiKey).join("[redacted]")
    .replace(/([?&](?:key|api_key)=)[^\s&#"']+/gi, "$1[redacted]");
}

async function findSupportedReplacement(ai: GoogleGenAI, signal: AbortSignal) {
  const modelKeys: string[] = [];
  const models = await ai.models.list({
    config: {
      pageSize: 100,
      abortSignal: signal,
      httpOptions: {
        timeout: 10_000,
        retryOptions: { attempts: 1 },
      },
    },
  });

  for await (const model of models) {
    if (!model.supportedActions?.includes("generateContent") || !model.name) {
      continue;
    }
    modelKeys.push(model.name.split("/").at(-1) ?? model.name);
  }

  return modelKeys.slice(0, 8);
}

function getGeminiErrorMessage(
  error: unknown,
  modelKey: string,
  apiKey: string,
) {
  const details = getErrorDetails(error);
  const providerMessage = redactApiKey(details.message, apiKey);

  if (details.status === 404) {
    return `Google Gemini could not find model "${modelKey}". Provider response: ${providerMessage}`;
  }
  if (details.status === 401 || details.status === 403) {
    return `Google Gemini rejected this request (HTTP ${details.status}). Check GEMINI_API_KEY access for model "${modelKey}".`;
  }
  if (details.status === 429) {
    return `Google Gemini rate-limited this request for model "${modelKey}". Please wait and try again.`;
  }
  if (details.status === 400) {
    return `Google Gemini rejected the request for model "${modelKey}": ${providerMessage}`;
  }
  return `Google Gemini could not complete this step with model "${modelKey}"${details.status ? ` (HTTP ${details.status})` : ""}. Please try again.`;
}

async function getReplacementSuggestion(ai: GoogleGenAI, signal: AbortSignal) {
  try {
    const models = await findSupportedReplacement(ai, signal);
    if (models.length > 0) {
      return ` Models verified for this API key that support generateContent: ${models.join(", ")}. Choose a replacement and update the model record manually; this app did not change it.`;
    }
    return " No replacement model supporting generateContent was returned for this API key.";
  } catch (error) {
    const details = getErrorDetails(error);
    console.error("Could not list Gemini models for a verified replacement.", {
      status: details.status || undefined,
    });
    return " A supported replacement could not be verified using this API key; check the Gemini model list in Google AI Studio.";
  }
}

function responseError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function isRlsDenied(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(
    error &&
      (error.code === "42501" ||
        error.message?.toLowerCase().includes("row-level security")),
  );
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return responseError("Invalid prompt chain.", 400);

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return responseError(authorization.error, 403);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return responseError(
      "Gemini is not configured on the server. Add GEMINI_API_KEY to the local server environment and Vercel.",
      503,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return responseError("Send the image using a multipart form.", 400);
  }

  const imageField = formData.get("image");
  let image:
    | { mimeType: string; data: string }
    | undefined;

  if (imageField instanceof File && imageField.size > 0) {
    if (!ALLOWED_IMAGE_TYPES.has(imageField.type)) {
      return responseError("Choose a JPEG, PNG, or WebP image.", 400);
    }
    if (imageField.size > MAX_IMAGE_SIZE) {
      return responseError("Images must be 10 MB or smaller.", 413);
    }
    const bytes = new Uint8Array(await imageField.arrayBuffer());
    if (!isValidImageSignature(imageField.type, bytes)) {
      return responseError("The uploaded file does not match its image type.", 400);
    }
    image = {
      mimeType: imageField.type,
      data: Buffer.from(bytes).toString("base64"),
    };
  } else if (imageField && !(imageField instanceof File)) {
    return responseError("The image upload is invalid.", 400);
  }

  const { data: chain, error: chainError } = await authorization.supabase
    .from("prompt_chains")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (chainError) {
    console.error("Unable to load prompt chain for execution.", chainError);
    return responseError(getDatabaseErrorMessage(chainError), 500);
  }
  if (!chain) return responseError("Prompt chain not found or unavailable.", 404);
  if (
    chain.name.trim().toLowerCase() === "funny image captions" &&
    !image
  ) {
    return responseError("Upload a JPEG, PNG, or WebP image to run this chain.", 400);
  }

  const { data: steps, error: stepsError } = await authorization.supabase
    .from("prompt_chain_steps")
    .select("id, step_order, name, prompt_template, llm_model_id, temperature")
    .eq("prompt_chain_id", id)
    .order("step_order", { ascending: true })
    .order("id", { ascending: true });

  if (stepsError) {
    console.error("Unable to load prompt-chain steps for execution.", stepsError);
    return responseError(
      getDatabaseErrorMessage(stepsError, "prompt_chain_steps"),
      500,
    );
  }
  if (!steps?.length) {
    return responseError("Add at least one step before running this chain.", 400);
  }
  if (steps.some((step) => !step.prompt_template.trim())) {
    return responseError("Every chain step must have a prompt template.", 400);
  }

  const modelIds = [...new Set(steps.map((step) => step.llm_model_id))];
  const { data: models, error: modelsError } = await authorization.supabase
    .from("llm_models")
    .select("id, name, model_key, is_active, supports_temperature")
    .in("id", modelIds);

  if (modelsError) {
    console.error("Unable to load models for prompt-chain execution.", modelsError);
    return responseError(getDatabaseErrorMessage(modelsError, "llm_models"), 500);
  }

  const modelsById = new Map<string, GeminiModel>();
  for (const rawModel of models ?? []) {
    const modelKey = normalizeGeminiModelKey(rawModel.model_key);
    if (!modelKey.valid) {
      console.warn("Prompt-chain step has an invalid Gemini model identifier", {
        modelKeyType: modelKey.modelKeyType,
        modelKeyLength: modelKey.modelKeyLength,
        escapedModelKey: escapeModelKeyForDiagnostics(rawModel.model_key, apiKey),
        removedModelsPrefixes: modelKey.removedModelsPrefixes,
        hadSurroundingWhitespace: modelKey.hadSurroundingWhitespace,
        category: "invalid-request",
      });
      continue;
    }
    modelsById.set(String(rawModel.id), {
      ...rawModel,
      request_model_id: modelKey.modelId,
    });
  }
  for (const step of steps as ChainStep[]) {
    const model = modelsById.get(String(step.llm_model_id));
    if (!model || !model.is_active || !model.request_model_id) {
      return responseError(
        `Step "${step.name}" uses a model that is inactive or unavailable under current RLS policies.`,
        400,
      );
    }
  }

  let generationRequest: { id: number } | null = null;
  let generationRequestError: { code?: string; message: string } | null = null;
  try {
    const result = await authorization.supabase
      .from("generation_requests")
      .insert({
        user_id: authorization.user.id,
        prompt_chain_id: chain.id,
        input_text: image ? "Image uploaded; image contents are not stored." : null,
        status: "running",
      })
      .select("id")
      .single();
    generationRequest = result.data;
    generationRequestError = result.error;
  } catch {
    console.error("Creating prompt-chain generation history could not reach Supabase.", {
      category: "database-transport-error",
    });
    return responseError(
      "The generation history record could not be created because Supabase could not be reached. The chain was not started.",
      503,
    );
  }

  if (generationRequestError || !generationRequest) {
    console.error("Could not create prompt-chain generation history.", {
      code: generationRequestError?.code,
      category: isRlsDenied(generationRequestError)
        ? "rls-denied"
        : "database-error",
    });
    return responseError(
      generationRequestError
        ? getDatabaseErrorMessage(generationRequestError, "generation_requests")
        : "The generation history record was not created; the chain was not started.",
      500,
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const encoder = new TextEncoder();
  const executionStartedAt = Date.now();
  const executionDeadline = executionStartedAt + MAX_EXECUTION_TIME_MS;
  const executionSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(MAX_EXECUTION_TIME_MS),
  ]);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        if (request.signal.aborted || controller.desiredSize === null) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // A disconnected client may cancel the stream between this check and enqueue.
        }
      };

      void (async () => {
        let previousOutput = "";
        let activeStep = 0;
        let activeModel = "";
        let runStatus: "completed" | "failed" | "cancelled" = "failed";
        let finalized = false;

        const finalizeGenerationRequest = async (
          status: "completed" | "failed" | "cancelled",
        ) => {
          let data: { id: number } | null = null;
          let error: { code?: string; message: string } | null = null;
          try {
            const result = await authorization.supabase
              .from("generation_requests")
              .update({ status, completed_at: new Date().toISOString() })
              .eq("id", generationRequest.id)
              .eq("user_id", authorization.user.id)
              .select("id")
              .maybeSingle();
            data = result.data;
            error = result.error;
          } catch {
            console.error("Generation history status update could not reach Supabase.", {
              requestId: String(generationRequest.id),
              status,
              category: "database-transport-error",
            });
            return false;
          }

          if (error || !data) {
            console.error("Could not finalize prompt-chain generation history.", {
              requestId: String(generationRequest.id),
              status,
              code: error?.code,
              category: isRlsDenied(error)
                ? "rls-denied"
                : error
                  ? "database-error"
                  : "row-not-updated",
            });
            return false;
          }
          finalized = true;
          return true;
        };

        try {
          for (const [index, rawStep] of (steps as ChainStep[]).entries()) {
            const stepNumber = index + 1;
            const model = modelsById.get(String(rawStep.llm_model_id))!;
            activeStep = stepNumber;
            activeModel = model.request_model_id;
            const modelKey = normalizeGeminiModelKey(model.model_key);
            console.info("Gemini chain step request", {
              model: model.request_model_id,
              step: stepNumber,
              stepLlmModelId: String(rawStep.llm_model_id),
              modelRowId: String(model.id),
              modelKeyType: modelKey.modelKeyType,
              modelKeyLength: modelKey.modelKeyLength,
              escapedModelKey: escapeModelKeyForDiagnostics(model.model_key, apiKey),
              removedModelsPrefixes: modelKey.removedModelsPrefixes,
              hadSurroundingWhitespace: modelKey.hadSurroundingWhitespace,
            });
            send({
              type: "progress",
              step: stepNumber,
              total: steps.length,
              name: rawStep.name,
              generationRequestId: String(generationRequest.id),
            });

            const prompt = previousOutput
              ? `Previous step output (actual generated content):\n${previousOutput}\n\nInstructions for this step:\n${rawStep.prompt_template}`
              : rawStep.prompt_template;
            const parts: Array<
              | { text: string }
              | { inlineData: { mimeType: string; data: string } }
            > = [{ text: prompt }];
            if (index === 0 && image) {
              parts.unshift({ inlineData: image });
            }

            let output: string | undefined;
            let outputLatencyMs = 0;
            let lastError: unknown;

            for (
              let attempt = 1;
              attempt <= MAX_MODEL_ATTEMPTS && !output;
              attempt += 1
            ) {
              const remainingMs = executionDeadline - Date.now();
              if (executionSignal.aborted || remainingMs <= 5_000) {
                console.warn("Gemini step attempt stopped", {
                  model: model.request_model_id,
                  step: stepNumber,
                  elapsedMs: Date.now() - executionStartedAt,
                  category: request.signal.aborted
                    ? "client-cancelled"
                    : "execution-deadline",
                });
                send({
                  type: "error",
                  message: request.signal.aborted
                    ? `Execution was cancelled during Step ${stepNumber} (${rawStep.name}).`
                    : `The execution time limit was reached during Step ${stepNumber} (${rawStep.name}). Completed steps were not retried.`,
                });
                return;
              }

              const attemptStartedAt = Date.now();
              try {
                const response = await ai.models.generateContent({
                  model: model.request_model_id,
                  contents: [{ role: "user", parts }],
                  config: {
                    abortSignal: executionSignal,
                    httpOptions: {
                      timeout: Math.min(
                        MAX_MODEL_REQUEST_TIME_MS,
                        remainingMs - 5_000,
                      ),
                      retryOptions: { attempts: 1 },
                    },
                    ...(model.supports_temperature === true &&
                    rawStep.temperature !== null &&
                    Number.isFinite(Number(rawStep.temperature))
                      ? { temperature: Number(rawStep.temperature) }
                      : {}),
                  },
                });
                output = response.text?.trim();
                outputLatencyMs = Math.max(
                  0,
                  Math.min(Date.now() - attemptStartedAt, 2_147_483_647),
                );
                console.info("Gemini step completed", {
                  model: model.request_model_id,
                  step: stepNumber,
                  elapsedMs: Date.now() - attemptStartedAt,
                  category: output ? "success" : "empty-response",
                });
                if (!output) {
                  send({
                    type: "error",
                    message: `Gemini returned an empty response for Step ${stepNumber} (${rawStep.name}).`,
                  });
                  return;
                }
              } catch (error) {
                lastError = error;
                const deadlineReached =
                  !request.signal.aborted &&
                  (executionSignal.aborted ||
                    Date.now() >= executionDeadline - 6_000);
                console.warn("Gemini step attempt failed", {
                  model: model.request_model_id,
                  step: stepNumber,
                  elapsedMs: Date.now() - attemptStartedAt,
                  category: request.signal.aborted
                    ? "client-cancelled"
                    : deadlineReached
                      ? "execution-deadline"
                      : getErrorCategory(error),
                });

                if (request.signal.aborted) return;
                if (deadlineReached) {
                  send({
                    type: "error",
                    message: `The execution time limit was reached during Step ${stepNumber} (${rawStep.name}). Completed steps were not retried.`,
                  });
                  return;
                }

                if (
                  !isRetryableGeminiError(error) ||
                  attempt === MAX_MODEL_ATTEMPTS
                ) {
                  break;
                }

                const delayMs = 1_000 * 2 ** (attempt - 1);
                send({
                  type: "retry",
                  step: stepNumber,
                  name: rawStep.name,
                  attempt: attempt + 1,
                  maxAttempts: MAX_MODEL_ATTEMPTS,
                  delayMs,
                });
                if (
                  Date.now() + delayMs + 5_000 >= executionDeadline ||
                  !(await waitForRetry(delayMs, executionSignal))
                ) {
                  send({
                    type: "error",
                    message: request.signal.aborted
                      ? `Execution was cancelled during Step ${stepNumber} (${rawStep.name}).`
                      : `The execution time limit was reached during Step ${stepNumber} (${rawStep.name}). Completed steps were not retried.`,
                  });
                  return;
                }
              }
            }

            if (!output) {
              const details = getErrorDetails(lastError);
              const message = getGeminiErrorMessage(
                lastError,
                model.request_model_id,
                apiKey,
              );
              const modelUnavailable =
                details.status === 404 ||
                /model.{0,30}(not found|not supported|unavailable)/i.test(
                  details.message,
                );
              const retryMessage =
                details.status === 503 || details.status === 504
                  ? ` Step ${stepNumber} (${rawStep.name}) failed after ${MAX_MODEL_ATTEMPTS} attempts. Completed steps were not rerun.`
                  : ` Step ${stepNumber} (${rawStep.name}) failed; the error is not eligible for automatic retry.`;
              send({
                type: "error",
                message: modelUnavailable
                  ? `${message} Step ${stepNumber} (${rawStep.name}) failed.${await getReplacementSuggestion(ai, executionSignal)}`
                  : `${message}${retryMessage}`,
              });
              return;
            }

            let responseSaveError: { code?: string; message: string } | null = null;
            try {
              const result = await authorization.supabase
                .from("llm_responses")
                .insert({
                  generation_request_id: generationRequest.id,
                  prompt_chain_step_id: rawStep.id,
                  llm_model_id: rawStep.llm_model_id,
                  response_text: output,
                  latency_ms: outputLatencyMs,
                });
              responseSaveError = result.error;
            } catch {
              console.error("Saving a successful step output could not reach Supabase.", {
                requestId: String(generationRequest.id),
                step: stepNumber,
                model: model.request_model_id,
                category: "database-transport-error",
              });
              send({
                type: "error",
                message: `Step ${stepNumber} succeeded, but its output could not be saved to generation history because Supabase could not be reached. The chain stopped to avoid continuing without durable history.`,
              });
              return;
            }
            if (responseSaveError) {
              console.error("Could not save successful prompt-chain step output.", {
                requestId: String(generationRequest.id),
                step: stepNumber,
                model: model.request_model_id,
                code: responseSaveError.code,
                category: isRlsDenied(responseSaveError)
                  ? "rls-denied"
                  : "database-error",
              });
              send({
                type: "error",
                message: `Step ${stepNumber} succeeded, but its output could not be saved to generation history. Check the llm_responses INSERT policy. The chain stopped to avoid continuing without durable history.`,
              });
              return;
            }

            previousOutput = output;
            send({
              type: "step_result",
              step: stepNumber,
              name: rawStep.name,
              output,
            });
          }

          if (request.signal.aborted || executionSignal.aborted) {
            runStatus = request.signal.aborted ? "cancelled" : "failed";
            return;
          }

          const historySaved = await finalizeGenerationRequest("completed");
          if (!historySaved) {
            send({
              type: "error",
              message:
                "The chain completed, but its final status could not be saved to generation history. Check the generation_requests UPDATE policy.",
            });
            return;
          }
          runStatus = "completed";
          send({ type: "complete" });
        } catch (error) {
          console.error("Prompt-chain execution failed unexpectedly.", {
            model: activeModel || undefined,
            step: activeStep || undefined,
            elapsedMs: Date.now() - executionStartedAt,
            category: getErrorCategory(error),
          });
          send({
            type: "error",
            message: "The chain could not be completed. Please try again.",
          });
        } finally {
          if (!finalized) {
            const finalStatus = request.signal.aborted
              ? "cancelled"
              : executionSignal.aborted
                ? "failed"
                : runStatus;
            const historyFinalized = await finalizeGenerationRequest(finalStatus);
            if (!historyFinalized) {
              send({
                type: "error",
                message: `The run ended with status "${finalStatus}", but its final history status could not be saved. Check the generation_requests UPDATE policy.`,
              });
            }
          }
          if (!request.signal.aborted && controller.desiredSize !== null) {
            try {
              controller.close();
            } catch {
              // The client may have disconnected while the last event was sent.
            }
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
