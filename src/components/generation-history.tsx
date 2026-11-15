"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export type GenerationHistoryItem = {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  outputs: Array<{
    id: string;
    stepId: string | null;
    stepOrder: number | null;
    stepName: string;
    output: string;
    latencyMs: number | null;
  }>;
};

export function GenerationHistory({
  items,
  error,
}: {
  items: GenerationHistoryItem[];
  error: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  return (
    <section className="generation-history" aria-labelledby="generation-history-title">
      <div className="generation-history-header">
        <div>
          <p className="eyebrow">THE BAKING LOG</p>
          <h2 id="generation-history-title">Generation History</h2>
        </div>
        <button
          className="secondary-button history-refresh-button"
          disabled={isRefreshing}
          onClick={() => startTransition(() => router.refresh())}
          type="button"
        >
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div className="history-state history-error" role="alert">
          <strong>History could not be loaded.</strong>
          <span>{error}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="history-state">
          <span className="history-empty-mark" aria-hidden="true">↗</span>
          <strong>No executions yet</strong>
          <span>Completed and failed runs will appear here.</span>
        </div>
      ) : (
        <div className="history-list">
          {items.map((item) => {
            const finalOutput = item.outputs.at(-1)?.output;
            return (
              <details className="history-run" key={item.id}>
                <summary>
                  <span className="history-run-main">
                    <span className="history-run-date">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <span className={`history-status status-${item.status}`}>
                      {item.status}
                    </span>
                  </span>
                  <span className="history-run-caption">
                    {finalOutput
                      ? `${item.outputs.length} saved step${item.outputs.length === 1 ? "" : "s"} · ${finalOutput.slice(0, 130)}${finalOutput.length > 130 ? "…" : ""}`
                      : "No step output was saved for this run."}
                  </span>
                  <span className="history-expand-label">View outputs</span>
                </summary>
                <div className="history-run-details">
                  <p className="history-run-time">
                    Started {new Date(item.createdAt).toLocaleString()}
                    {item.completedAt
                      ? ` · Finished ${new Date(item.completedAt).toLocaleString()}`
                      : " · Not finished"}
                  </p>
                  {item.outputs.length === 0 ? (
                    <p className="history-no-output">
                      No successful step output was saved.
                    </p>
                  ) : (
                    <div className="history-output-list">
                      {item.outputs.map((output, index) => {
                        const isFinal = index === item.outputs.length - 1;
                        return (
                          <article className="history-output" key={output.id}>
                            <div className="history-output-heading">
                              <span className="history-step-number">
                                {output.stepOrder ?? index + 1}
                              </span>
                              <div>
                                <p className="eyebrow">
                                  {isFinal ? "THE CHERRY ON TOP" : `STEP ${output.stepOrder ?? index + 1}`}
                                </p>
                                <h3>{output.stepName}</h3>
                              </div>
                              {output.latencyMs !== null && (
                                <span className="history-latency">
                                  {(output.latencyMs / 1000).toFixed(1)}s
                                </span>
                              )}
                            </div>
                            <div className="history-output-text">{output.output}</div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
