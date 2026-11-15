"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type StepOutput = {
  step: number;
  name: string;
  output: string;
};

type RunEvent =
  | { type: "progress"; step: number; total: number; name: string }
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

export function PromptChainRunner({
  chainId,
  chainName,
}: {
  chainId: string;
  chainName: string;
}) {
  const router = useRouter();
  const imageRequired = chainName.trim().toLowerCase() === "funny image captions";
  const submitting = useRef(false);
  const testingModel = useRef(false);
  const activeRun = useRef<AbortController | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [progress, setProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [modelTestMessage, setModelTestMessage] = useState("");
  const [modelTestError, setModelTestError] = useState(false);
  const [outputs, setOutputs] = useState<StepOutput[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    return () => activeRun.current?.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    submitting.current = true;
    setIsRunning(true);
    setProgress("Starting chain...");
    setErrorMessage("");
    setOutputs([]);
    setIsComplete(false);
    const controller = new AbortController();
    activeRun.current = controller;

    try {
      const response = await fetch(`/api/chains/${chainId}/run`, {
        method: "POST",
        body: new FormData(event.currentTarget),
        signal: controller.signal,
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(result?.error ?? "The chain could not be started.");
      }

      if (!response.body) {
        throw new Error("The server did not return chain progress.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      function processEvent(line: string) {
        if (!line.trim()) return;
        const item = JSON.parse(line) as RunEvent;
        if (item.type === "progress") {
          setProgress(`Running Step ${item.step} of ${item.total}: ${item.name}`);
        } else if (item.type === "retry") {
          setProgress(
            `Temporary Gemini issue. Retrying Step ${item.step}: ${item.name} in ${Math.ceil(item.delayMs / 1000)}s (attempt ${item.attempt} of ${item.maxAttempts})...`,
          );
        } else if (item.type === "step_result") {
          setOutputs((current) => [
            ...current.filter((output) => output.step !== item.step),
            item,
          ]);
        } else if (item.type === "complete") {
          setProgress("Complete");
          setIsComplete(true);
          router.refresh();
        } else {
          setErrorMessage(item.message);
          setProgress("");
        }
      }

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processEvent(line);
        if (done) break;
      }
      if (buffer.trim()) processEvent(buffer);
    } catch (error) {
      setProgress("");
      setErrorMessage(
        controller.signal.aborted
          ? "Execution cancelled. Completed step outputs are still shown above."
          : error instanceof Error
          ? error.message
          : "The chain could not be completed. Please try again.",
      );
    } finally {
      submitting.current = false;
      activeRun.current = null;
      setIsRunning(false);
    }
  }

  function cancelRun() {
    activeRun.current?.abort();
  }

  async function handleTestModel() {
    if (testingModel.current || submitting.current) return;
    testingModel.current = true;
    setIsTestingModel(true);
    setModelTestMessage("");
    setModelTestError(false);
    try {
      const response = await fetch(`/api/chains/${chainId}/test-model`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        ok?: boolean;
        status?: number;
        category?: string;
        model?: string;
        message?: string;
        diagnostic?: {
          modelKeyType?: string;
          modelKeyLength?: number | null;
          escapedModelKey?: string;
          stepLlmModelId?: string;
          modelRowId?: string;
        };
      };
      if (!response.ok) {
        const status = result.status ?? response.status;
        const category = result.category ?? "unknown";
        const message = result.message ?? "Model access could not be verified.";
        const diagnostic = result.diagnostic;
        setModelTestError(true);
        setModelTestMessage(
          `Gemini test failed${result.model ? ` for "${result.model}"` : ""} (HTTP ${status}, ${category}): ${message}${
            diagnostic
              ? ` Stored model_key: type=${diagnostic.modelKeyType ?? "unknown"}, length=${diagnostic.modelKeyLength ?? "unknown"}, value=${diagnostic.escapedModelKey ?? "unavailable"}; step llm_model_id=${diagnostic.stepLlmModelId ?? "unknown"}, fetched model row id=${diagnostic.modelRowId ?? "unknown"}.`
              : ""
          }`,
        );
        return;
      }
      setModelTestMessage(result.message ?? "Model access test completed.");
    } catch (error) {
      setModelTestError(true);
      setModelTestMessage(
        `Gemini test failed (no HTTP status, unknown): ${
          error instanceof Error
            ? error.message
            : "Model access could not be verified."
        }`,
      );
    } finally {
      testingModel.current = false;
      setIsTestingModel(false);
    }
  }

  return (
    <section className="chain-runner" aria-labelledby="run-chain-heading">
      <div className="chain-runner-heading">
        <div>
          <p className="eyebrow">EXECUTION</p>
          <h2 id="run-chain-heading">Run this chain</h2>
          <p>
            Run each configured step in order and pass each result to the next
            step.
          </p>
        </div>
      </div>
      <form className="chain-run-form" onSubmit={handleSubmit}>
        <label htmlFor="chain-run-image">
          Image {imageRequired ? " (required)" : " (optional)"}
        </label>
        <input
          accept="image/jpeg,image/png,image/webp"
          disabled={isRunning || isTestingModel}
          id="chain-run-image"
          name="image"
          required={imageRequired}
          type="file"
        />
        <p className="run-image-help">
          JPEG, PNG, or WebP. Maximum file size: 10 MB.
        </p>
        <button
          className="primary-button run-chain-button"
          disabled={isRunning || isTestingModel}
        >
          {isRunning ? "Running chain..." : "Run Chain"}
        </button>
      </form>
      <div className="model-access-test">
        <button
          className="secondary-button"
          disabled={isRunning || isTestingModel}
          onClick={handleTestModel}
          type="button"
        >
          {isTestingModel ? "Testing model..." : "Test First Step Model"}
        </button>
        <p>
          Sends one short request to the model configured for the first step.
          This uses Gemini quota.
        </p>
      </div>
      {modelTestMessage && (
        <p
          className={`chain-notice ${modelTestError ? "notice-error" : "notice-success"}`}
          role={modelTestError ? "alert" : "status"}
        >
          <span aria-hidden="true">{modelTestError ? "!" : "✓"}</span>
          {modelTestMessage}
        </p>
      )}

      {(isRunning || isComplete) && (
        <p
          className={`run-progress ${isComplete ? "run-complete" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span aria-hidden="true">{isComplete ? "✓" : <span className="run-spinner" />}</span>
          {progress}
        </p>
      )}
      {isRunning && (
        <button
          className="run-cancel-button"
          onClick={cancelRun}
          type="button"
        >
          Cancel run
        </button>
      )}

      {errorMessage && (
        <p className="chain-notice notice-error" role="alert">
          <span aria-hidden="true">!</span>
          {errorMessage}
        </p>
      )}

      {outputs.length > 0 && (
        <div className="run-output-list" aria-label="Generated step outputs">
          {outputs.map((item, index) => {
            const isFinal = isComplete && index === outputs.length - 1;
            return (
              <article
                className={`run-output-card ${isFinal ? "run-final-output" : ""}`}
                key={`${item.step}-${item.name}`}
              >
                <div className="run-output-heading">
                  <span className="run-output-number">
                    {String(item.step).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="eyebrow">
                      {isFinal ? "THE CHERRY ON TOP" : `STEP ${item.step} OUTPUT`}
                    </p>
                    <h3>{item.name}</h3>
                  </div>
                </div>
                <div className="run-output-text">{item.output}</div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
