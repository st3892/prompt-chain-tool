"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPromptChain,
  deletePromptChain,
  updatePromptChain,
} from "@/app/actions";
import type { PromptChain } from "@/lib/prompt-chains";
import type { LlmModel } from "@/lib/prompt-chain-steps";
import { PromptChainStepsManager } from "@/components/prompt-chain-steps-manager";

export function PromptChainManager({
  initialChains,
  loadError,
  models,
  modelsLoadError,
}: {
  initialChains: PromptChain[];
  loadError: string | null;
  models: LlmModel[];
  modelsLoadError: string | null;
}) {
  const router = useRouter();
  const [chains, setChains] = useState(initialChains);
  const [editingChain, setEditingChain] = useState<PromptChain | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState<{
    message: string;
    success: boolean;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setNotice(null);
    setEditingChain(null);
    setIsCreating(true);
  }

  function openEditForm(chain: PromptChain) {
    setNotice(null);
    setIsCreating(false);
    setEditingChain(chain);
  }

  function closeForm() {
    setIsCreating(false);
    setEditingChain(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = editingChain
        ? await updatePromptChain(editingChain.id, formData)
        : await createPromptChain(formData);

      setNotice({ message: result.message, success: result.success });

      if (!result.success) return;

      const savedChain = result.chain;
      if (savedChain) {
        setChains((currentChains) =>
          editingChain
            ? currentChains.map((chain) =>
                chain.id === savedChain.id ? savedChain : chain,
              )
            : [...currentChains, savedChain].sort((a, b) =>
                a.id.localeCompare(b.id, undefined, { numeric: true }),
              ),
        );
      }

      closeForm();
      router.refresh();
    });
  }

  function handleDelete(chain: PromptChain) {
    if (!window.confirm(`Delete "${chain.name}"? This action cannot be undone.`)) {
      return;
    }

    setNotice(null);
    startTransition(async () => {
      const result = await deletePromptChain(chain.id);
      setNotice({ message: result.message, success: result.success });

      if (result.success) {
        setChains((currentChains) =>
          currentChains.filter((item) => item.id !== chain.id),
        );
        if (editingChain?.id === chain.id) closeForm();
        router.refresh();
      }
    });
  }

  return (
    <section className="chains-section" aria-labelledby="chains-heading">
      <div className="chains-heading-row">
        <div>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h2 id="chains-heading">Prompt chains</h2>
        </div>
        <button className="primary-button create-chain-button" onClick={openCreateForm}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12m6-6H4" />
          </svg>
          Create Prompt Chain
        </button>
      </div>

      {notice && (
        <p
          className={`chain-notice ${notice.success ? "notice-success" : "notice-error"}`}
          role={notice.success ? "status" : "alert"}
        >
          <span aria-hidden="true">{notice.success ? "✓" : "!"}</span>
          {notice.message}
        </p>
      )}

      {loadError ? (
        <div className="chains-load-error" role="alert">
          <strong>Could not load prompt chains</strong>
          <p>{loadError}</p>
        </div>
      ) : (
        <>
          {(isCreating || editingChain) && (
            <form className="chain-editor" onSubmit={handleSave}>
              <div className="chain-editor-heading">
                <div>
                  <p className="eyebrow">
                    {editingChain ? "UPDATE DETAILS" : "NEW WORKSPACE ITEM"}
                  </p>
                  <h3>{editingChain ? "Edit prompt chain" : "Create prompt chain"}</h3>
                </div>
                <button
                  aria-label="Close form"
                  className="icon-button"
                  onClick={closeForm}
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                    <path d="m5 5 10 10M15 5 5 15" />
                  </svg>
                </button>
              </div>
              <label htmlFor="chain-name">Name</label>
              <input
                autoFocus
                defaultValue={editingChain?.name ?? ""}
                id="chain-name"
                maxLength={200}
                name="name"
                placeholder="e.g. Product description writer"
                required
              />
              <label htmlFor="chain-description">Description</label>
              <textarea
                defaultValue={editingChain?.description ?? ""}
                id="chain-description"
                name="description"
                placeholder="What does this prompt chain help you do?"
                rows={3}
              />
              <div className="chain-editor-actions">
                <button
                  className="cancel-button"
                  disabled={isPending}
                  onClick={closeForm}
                  type="button"
                >
                  Cancel
                </button>
                <button className="primary-button save-chain-button" disabled={isPending}>
                  {isPending
                    ? "Saving..."
                    : editingChain
                      ? "Save changes"
                      : "Create chain"}
                </button>
              </div>
            </form>
          )}

          {chains.length === 0 ? (
            <div className="chains-empty-state">
              <span className="empty-chain-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M8 7h8m-8 5h8m-8 5h5" />
                  <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
                </svg>
              </span>
              <h3>No prompt chains yet</h3>
              <p>Create your first chain to get started. You can add prompts and steps later.</p>
              <button className="secondary-create-button" onClick={openCreateForm}>
                Create your first chain
              </button>
            </div>
          ) : (
            <div className="chain-list">
              {chains.map((chain, index) => (
                <article className="chain-item" key={chain.id}>
                  <span className="chain-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="chain-details">
                    <h3>{chain.name || "Untitled prompt chain"}</h3>
                    <p>{chain.description || "No description provided."}</p>
                  </div>
                  <div className="chain-item-actions">
                    <button
                      aria-label={`Edit ${chain.name}`}
                      className="icon-button"
                      disabled={isPending}
                      onClick={() => openEditForm(chain)}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                        <path d="m13.5 4.5 2 2M4 16l3.5-.7L16 6.8a1.4 1.4 0 0 0-2-2l-8.5 8.5L4 16Z" />
                      </svg>
                    </button>
                    <button
                      aria-label={`Delete ${chain.name}`}
                      className="icon-button delete-chain-button"
                      disabled={isPending}
                      onClick={() => handleDelete(chain)}
                      type="button"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                        <path d="M4.5 6h11m-9.5 0 .6 10h7.8L15 6M8 6V4h4v2m-3 3v4m2-4v4" />
                      </svg>
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {chains.length > 0 && (
            <PromptChainStepsManager
              chains={chains}
              models={models}
              modelsLoadError={modelsLoadError}
            />
          )}
        </>
      )}
    </section>
  );
}
