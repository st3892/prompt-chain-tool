import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { getDatabaseErrorMessage, getSuperadminClient } from "@/lib/supabase/admin";
import {
  escapeModelKeyForDiagnostics,
  normalizeGeminiModelKey,
} from "@/lib/gemini-model";

export const runtime = "nodejs";
export const maxDuration = 40;

type ErrorCategory =
  | "authentication"
  | "invalid-request"
  | "quota"
  | "model-not-found"
  | "temporary-service"
  | "unknown";

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return { status: 0, message: "" };
  }

  const details = error as { status?: unknown; code?: unknown; message?: unknown };
  const value = details.status ?? details.code;
  const status =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : 0;

  return {
    status,
    message: typeof details.message === "string" ? details.message : "",
  };
}

function getCategory(status: number, message: string): ErrorCategory {
  if (
    status === 401 ||
    status === 403 ||
    /api[\s_-]*key.{0,40}(invalid|not valid|unauthorized)|unauthorized.{0,40}api[\s_-]*key/i.test(
      message,
    )
  ) {
    return "authentication";
  }
  if (status === 429) return "quota";
  if (
    status === 404 ||
    /model.{0,40}(not found|not supported|does not exist)/i.test(message)
  ) {
    return "model-not-found";
  }
  if (status === 503 || status === 504) return "temporary-service";
  if (status === 400) return "invalid-request";
  return "unknown";
}

function sanitizeProviderMessage(message: string, apiKey: string) {
  let safeMessage = message;
  const jsonStart = safeMessage.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(safeMessage.slice(jsonStart)) as {
        error?: { message?: unknown };
      };
      if (typeof parsed.error?.message === "string") {
        safeMessage = parsed.error.message;
      }
    } catch {
      // Keep the text portion; the sanitization below removes sensitive patterns.
    }
  }

  safeMessage = safeMessage
    .replace(/\n\s*at\s+[\s\S]*$/i, "")
    .split(apiKey).join("[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "[image data redacted]")
    .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "[payload redacted]")
    .replace(
      /\b(headers?|request payload|inlineData|contents)\s*[:=]\s*(?:\{[^}]*\}|\[[^\]]*\]|[^\n]+)/gi,
      "$1: [request details redacted]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/([?&](?:key|api_key)=)[^\s&#"']+/gi, "$1[redacted]")
    .replace(/(?:api[_-]?key["'=:\s]+)[^,\s"'&]+/gi, "API key [redacted]")
    .replace(/https?:\/\/\S+/gi, "[URL redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!safeMessage || /^(?:error|unknown error)$/i.test(safeMessage)) {
    return "Gemini returned no additional error details.";
  }
  return safeMessage.slice(0, 500);
}

function failureResponse(
  status: number,
  category: ErrorCategory,
  message: string,
  model?: string,
  diagnostic?: Record<string, string | number | null>,
) {
  const responseStatus = status >= 400 && status <= 599 ? status : 500;
  return NextResponse.json(
    {
      ok: false,
      status: responseStatus,
      category,
      message,
      ...(model ? { model } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    },
    { status: responseStatus },
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return failureResponse(400, "unknown", "Invalid prompt chain.");
  }

  const authorization = await getSuperadminClient();
  if (!authorization.authorized) {
    return failureResponse(403, "authentication", authorization.error);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return failureResponse(
      503,
      "unknown",
      "Gemini is not configured on the server.",
    );
  }

  const { data: step, error: stepError } = await authorization.supabase
    .from("prompt_chain_steps")
    .select("id, step_order, llm_model_id")
    .eq("prompt_chain_id", id)
    .order("step_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stepError) {
    return failureResponse(
      500,
      "unknown",
      getDatabaseErrorMessage(stepError, "prompt_chain_steps"),
    );
  }
  if (!step) {
    return failureResponse(
      400,
      "unknown",
      "Add a step before testing its configured model.",
    );
  }

  const { data: model, error: modelError } = await authorization.supabase
    .from("llm_models")
    .select("id, name, model_key, is_active")
    .eq("id", step.llm_model_id)
    .maybeSingle();

  if (modelError) {
    return failureResponse(
      500,
      "unknown",
      getDatabaseErrorMessage(modelError, "llm_models"),
    );
  }
  if (!model || !model.is_active) {
    return failureResponse(
      400,
      "unknown",
      "The first step's model is inactive or unavailable under current RLS policies.",
    );
  }
  if (String(model.id) !== String(step.llm_model_id)) {
    console.error("Gemini model test resolved a different model row than the step references.", {
      stepLlmModelId: String(step.llm_model_id),
      modelRowId: String(model.id),
    });
    return failureResponse(
      500,
      "unknown",
      "The first step model reference could not be verified.",
    );
  }

  const modelKey = normalizeGeminiModelKey(model.model_key);
  if (!modelKey.valid) {
    const diagnostic = {
      modelKeyType: modelKey.modelKeyType,
      modelKeyLength: modelKey.modelKeyLength,
      escapedModelKey: escapeModelKeyForDiagnostics(model.model_key, apiKey),
      stepLlmModelId: String(step.llm_model_id),
      modelRowId: String(model.id),
    };
    console.warn("Gemini model test rejected an invalid model identifier", {
      ...diagnostic,
      step: step.step_order,
      removedModelsPrefixes: modelKey.removedModelsPrefixes,
      hadSurroundingWhitespace: modelKey.hadSurroundingWhitespace,
      category: "invalid-request",
    });
    return failureResponse(
      400,
      "invalid-request",
      "The first step's model_key is empty, too long, or contains unsupported control/query characters.",
      undefined,
      diagnostic,
    );
  }

  const startedAt = Date.now();
  console.info("Gemini model test request", {
    model: modelKey.modelId,
    step: step.step_order,
    stepLlmModelId: String(step.llm_model_id),
    modelRowId: String(model.id),
    modelKeyType: modelKey.modelKeyType,
    modelKeyLength: modelKey.modelKeyLength,
    escapedModelKey: escapeModelKeyForDiagnostics(model.model_key, apiKey),
    removedModelsPrefixes: modelKey.removedModelsPrefixes,
    hadSurroundingWhitespace: modelKey.hadSurroundingWhitespace,
  });
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelKey.modelId,
      contents: "Reply with exactly: Model access is working.",
      config: {
        abortSignal: _request.signal,
        httpOptions: {
          timeout: 30_000,
          retryOptions: { attempts: 1 },
        },
      },
    });
    const elapsedMs = Date.now() - startedAt;
    const hasOutput = Boolean(response.text?.trim());
    console.info("Gemini model access test completed", {
      model: modelKey.modelId,
      step: step.step_order,
      elapsedMs,
      category: hasOutput ? "success" : "empty-response",
    });
    return NextResponse.json({
      ok: true,
      model: modelKey.modelId,
      message: hasOutput
        ? `Model access is working for ${modelKey.modelId}.`
        : "The model returned an empty response. Check the server logs for the sanitized result category.",
    });
  } catch (error) {
    const details = getErrorDetails(error);
    const status =
      details.status >= 400 && details.status <= 599 ? details.status : 502;
    const category = getCategory(status, details.message);
    const safeProviderMessage = sanitizeProviderMessage(
      details.message,
      apiKey,
    );
    console.warn("Gemini model access test failed", {
      model: modelKey.modelId,
      step: step.step_order,
      elapsedMs: Date.now() - startedAt,
      status,
      category,
    });
    const prefix =
      category === "authentication"
        ? "Gemini rejected the credentials or model access"
        : category === "invalid-request"
          ? "Gemini rejected the request"
          : category === "quota"
            ? "Gemini quota or rate limit was reached"
            : category === "model-not-found"
              ? "Gemini could not find or use the configured model"
              : category === "temporary-service"
                ? "Gemini is temporarily unavailable"
                : "Gemini model access could not be verified";
    return failureResponse(
      status,
      category,
      `${prefix}: ${safeProviderMessage}`,
      modelKey.modelId,
    );
  }
}
