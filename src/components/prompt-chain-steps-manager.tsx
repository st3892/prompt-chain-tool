"use client";

import { FormEvent, useState, useTransition } from "react";
import {
  createPromptChainStep,
  deletePromptChainStep,
  getPromptChainSteps,
  movePromptChainStep,
  updatePromptChainStep,
} from "@/app/actions";
import type { PromptChain } from "@/lib/prompt-chains";
import type { LlmModel, PromptChainStep } from "@/lib/prompt-chain-steps";

export function PromptChainStepsManager({
  chains,
  models,
  modelsLoadError,
}: {
  chains: PromptChain[];
  models: LlmModel[];
  modelsLoadError: string | null;
}) {
  const [selectedChainId, setSelectedChainId] = useState("");
  const [steps, setSteps] = useState<PromptChainStep[]>([]);
  const [stepsError, setStepsError] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const [editingStep, setEditingStep] = useState<PromptChainStep | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  function chooseChain(chainId: string) {
    setSelectedChainId(chainId);
    setSteps([]);
    setStepsError("");
    setNotice(null);
    setEditingStep(null);
    setIsCreating(false);

    if (!chainId) return;

    startTransition(async () => {
      const result = await getPromptChainSteps(chainId);
      if (result.success) {
        setSteps(result.steps ?? []);
      } else {
        setStepsError(result.message);
      }
    });
  }

  function reloadSteps(chainId: string) {
    return getPromptChainSteps(chainId).then((result) => {
      if (!result.success) {
        setStepsError(result.message);
        return false;
      }
      setSteps(result.steps ?? []);
      setStepsError("");
      return true;
    });
  }

  function openCreateForm() {
    setNotice(null);
    setEditingStep(null);
    setIsCreating(true);
  }

  function openEditForm(step: PromptChainStep) {
    setNotice(null);
    setIsCreating(false);
    setEditingStep(step);
  }

  function closeForm() {
    setIsCreating(false);
    setEditingStep(null);
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const editing = editingStep;
    const chainId = selectedChainId;

    startTransition(async () => {
      const result = editing
        ? await updatePromptChainStep(chainId, editing.id, formData)
        : await createPromptChainStep(chainId, formData);

      setNotice({ message: result.message, success: result.success });
      if (!result.success) return;

      if (result.step) {
        setSteps((current) =>
          editing
            ? current.map((step) =>
                step.id === result.step?.id ? result.step : step,
              )
            : [...current, result.step!].sort(
                (a, b) =>
                  a.step_order - b.step_order ||
                  a.id.localeCompare(b.id, undefined, { numeric: true }),
              ),
        );
      }
      closeForm();
    });
  }

  function handleDelete(step: PromptChainStep) {
    if (!window.confirm(`Delete step "${step.name}"? This cannot be undone.`)) {
      return;
    }

    setNotice(null);
    startTransition(async () => {
      const result = await deletePromptChainStep(selectedChainId, step.id);
      setNotice({ message: result.message, success: result.success });
      if (!result.success) return;

      setSteps((current) => current.filter((item) => item.id !== step.id));
      if (editingStep?.id === step.id) closeForm();
    });
  }

  function handleMove(step: PromptChainStep, direction: "up" | "down") {
    setNotice(null);
    startTransition(async () => {
      const result = await movePromptChainStep(
        selectedChainId,
        step.id,
        direction,
      );
      if (!result.success) {
        setNotice({ message: result.message, success: false });
        return;
      }

      const refreshed = await reloadSteps(selectedChainId);
      setNotice({
        message: refreshed
          ? result.message
          : "The order was updated, but the latest steps could not be loaded.",
        success: refreshed,
      });
    });
  }

  return (
    <section className="steps-section" aria-labelledby="steps-heading">
      <div className="steps-title">
        <div>
          <p className="eyebrow">STEP BUILDER</p>
          <h2 id="steps-heading">Prompt chain steps</h2>
        </div>
      </div>

      <label className="chain-select-label" htmlFor="selected-chain">
        Select a prompt chain
      </label>
      <select
        className="chain-select"
        id="selected-chain"
        onChange={(event) => chooseChain(event.target.value)}
        value={selectedChainId}
      >
        <option value="">Choose a prompt chain...</option>
        {chains.map((chain) => (
          <option key={chain.id} value={chain.id}>
            {chain.name}
          </option>
        ))}
      </select>

      {selectedChainId && (
        <div className="steps-panel">
          <div className="steps-panel-heading">
            <div>
              <p className="eyebrow">ORDERED WORKFLOW</p>
              <h3>
                {chains.find((chain) => chain.id === selectedChainId)?.name}
              </h3>
            </div>
            <button
              className="primary-button create-step-button"
              disabled={isPending || models.length === 0 || Boolean(modelsLoadError)}
              onClick={openCreateForm}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M10 4v12m6-6H4" />
              </svg>
              Add step
            </button>
          </div>

          {modelsLoadError ? (
            <p className="step-inline-message step-error" role="alert">
              AI models could not be loaded. {modelsLoadError}
            </p>
          ) : models.length === 0 ? (
            <p className="step-inline-message step-info" role="status">
              No active AI models are available. Add and activate a model in
              Supabase before creating steps; each step requires a valid
              `llm_model_id`. If active models already exist, check the
              `llm_models` SELECT policy for this signed-in account.
            </p>
          ) : null}

          {notice && (
            <p
              className={`chain-notice ${notice.success ? "notice-success" : "notice-error"}`}
              role={notice.success ? "status" : "alert"}
            >
              <span aria-hidden="true">{notice.success ? "✓" : "!"}</span>
              {notice.message}
            </p>
          )}

          {isCreating && (
            <StepEditor
              key="new-step"
              models={models}
              pending={isPending}
              onCancel={closeForm}
              onSubmit={handleSave}
            />
          )}
          {editingStep && (
            <StepEditor
              key={editingStep.id}
              models={models}
              pending={isPending}
              step={editingStep}
              onCancel={closeForm}
              onSubmit={handleSave}
            />
          )}

          {isPending && !isCreating && !editingStep && (
            <p className="steps-loading" role="status">
              Loading or updating steps...
            </p>
          )}
          {stepsError ? (
            <p className="step-inline-message step-error" role="alert">
              Could not load steps. {stepsError}
            </p>
          ) : steps.length === 0 && !isPending ? (
            <div className="steps-empty-state">
              <span className="empty-chain-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M8 7h8m-8 5h8m-8 5h5" />
                  <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
                </svg>
              </span>
              <h3>No steps in this chain yet</h3>
              <p>Add the first step to define what this chain should do.</p>
            </div>
          ) : (
            <div className="step-list">
              {steps.map((step, index) => {
                const model = models.find(
                  (item) => item.id === step.llm_model_id,
                );
                return (
                  <article className="step-card" key={step.id}>
                    <div className="step-card-header">
                      <span className="step-order">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="step-card-title">
                        <h4>{step.name}</h4>
                        <span className="step-model">
                          {model?.name ??
                            `Model unavailable (ID ${step.llm_model_id})`}
                        </span>
                      </div>
                      <div className="step-controls">
                        <button
                          aria-label={`Move ${step.name} up`}
                          className="icon-button"
                          disabled={isPending || index === 0}
                          onClick={() => handleMove(step, "up")}
                          title="Move up"
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                            <path d="m5 12 5-5 5 5" />
                          </svg>
                        </button>
                        <button
                          aria-label={`Move ${step.name} down`}
                          className="icon-button"
                          disabled={isPending || index === steps.length - 1}
                          onClick={() => handleMove(step, "down")}
                          title="Move down"
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                            <path d="m5 8 5 5 5-5" />
                          </svg>
                        </button>
                        <button
                          aria-label={`Edit ${step.name}`}
                          className="icon-button"
                          disabled={isPending}
                          onClick={() => openEditForm(step)}
                          title="Edit step"
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                            <path d="m13.5 4.5 2 2M4 16l3.5-.7L16 6.8a1.4 1.4 0 0 0-2-2l-8.5 8.5L4 16Z" />
                          </svg>
                        </button>
                        <button
                          aria-label={`Delete ${step.name}`}
                          className="icon-button delete-chain-button"
                          disabled={isPending}
                          onClick={() => handleDelete(step)}
                          title="Delete step"
                          type="button"
                        >
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                            <path d="M4.5 6h11m-9.5 0 .6 10h7.8L15 6M8 6V4h4v2m-3 3v4m2-4v4" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="step-template">{step.prompt_template}</p>
                    {model?.supports_temperature && (
                      <span className="step-temperature">
                        Temperature: {step.temperature ?? "not set"}
                      </span>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StepEditor({
  models,
  step,
  pending,
  onCancel,
  onSubmit,
}: {
  models: LlmModel[];
  step?: PromptChainStep;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const initialModelId =
    models.find((model) => model.id === step?.llm_model_id)?.id ??
    models[0]?.id ??
    "";
  const [modelId, setModelId] = useState(initialModelId);
  const selectedModel = models.find((model) => model.id === modelId);

  return (
    <form className="step-editor" onSubmit={onSubmit}>
      <div className="chain-editor-heading">
        <div>
          <p className="eyebrow">{step ? "UPDATE STEP" : "NEW STEP"}</p>
          <h3>{step ? "Edit step" : "Create a step"}</h3>
        </div>
        <button
          aria-label="Close form"
          className="icon-button"
          onClick={onCancel}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>

      <label htmlFor="step-name">Step name</label>
      <input
        autoFocus
        defaultValue={step?.name ?? ""}
        id="step-name"
        maxLength={200}
        name="name"
        placeholder="e.g. Describe the image"
        required
      />
      <label htmlFor="step-prompt-template">Prompt template</label>
      <textarea
        defaultValue={step?.prompt_template ?? ""}
        id="step-prompt-template"
        name="prompt_template"
        placeholder="Write the instructions for this step..."
        required
        rows={5}
      />
      <label htmlFor="step-model">AI model</label>
      {models.length > 0 ? (
        <select
          id="step-model"
          name="llm_model_id"
          onChange={(event) => setModelId(event.target.value)}
          required
          value={modelId}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="step-inline-message step-info">
          No active models are available. The existing model assignment will
          be kept while editing this step.
        </p>
      )}
      {selectedModel?.supports_temperature && (
        <>
          <label htmlFor="step-temperature">Temperature</label>
          <input
            defaultValue={step?.temperature ?? 0.7}
            id="step-temperature"
            min="0"
            name="temperature"
            required
            step="any"
            type="number"
          />
        </>
      )}
      <div className="chain-editor-actions">
        <button
          className="cancel-button"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="primary-button save-chain-button"
          disabled={pending || (models.length === 0 && !step)}
        >
          {pending ? "Saving..." : step ? "Save changes" : "Create step"}
        </button>
      </div>
    </form>
  );
}
