"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createPromptChain,
  deletePromptChain,
  updatePromptChain,
} from "@/app/actions";
import type { PromptChain } from "@/lib/prompt-chains";

type ManagedPromptChain = PromptChain & { stepCount: number | null };

export function PromptChainManager({
  initialChains,
  loadError,
}: {
  initialChains: ManagedPromptChain[];
  loadError: string | null;
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
      let result: Awaited<ReturnType<typeof createPromptChain>>;
      try {
        result = editingChain
          ? await updatePromptChain(editingChain.id, formData)
          : await createPromptChain(formData);
      } catch {
        setNotice({
          message: "The save could not be confirmed. Refresh the page before trying again.",
          success: false,
        });
        router.refresh();
        return;
      }

      setNotice({ message: result.message, success: result.success });

      if (!result.success) return;

      const savedChain = result.chain;
      if (savedChain) {
        const savedChainWithCount: ManagedPromptChain = {
          ...savedChain,
          stepCount: editingChain
            ? chains.find((chain) => chain.id === savedChain.id)?.stepCount ?? 0
            : 0,
        };
        setChains((currentChains) =>
          editingChain
            ? currentChains.map((chain) =>
                chain.id === savedChainWithCount.id
                  ? savedChainWithCount
                  : chain,
              )
            : [...currentChains, savedChainWithCount].sort((a, b) =>
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
      let result: Awaited<ReturnType<typeof deletePromptChain>>;
      try {
        result = await deletePromptChain(chain.id);
      } catch {
        setNotice({
          message: "The delete could not be confirmed. Refresh the page to check the recipe list.",
          success: false,
        });
        router.refresh();
        return;
      }
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
          <p className="eyebrow">YOUR RECIPE BOX</p>
          <h2 id="chains-heading">Prompt chains &amp; recipes</h2>
        </div>
        <button className="primary-button create-chain-button" onClick={openCreateForm}>
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M10 4v12m6-6H4" />
          </svg>
          Create recipe
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
                    {editingChain ? "EDIT RECIPE" : "A NEW RECIPE"}
                  </p>
                  <h3>{editingChain ? "Edit prompt recipe" : "Create a prompt recipe"}</h3>
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
                placeholder="e.g. Funny image captions"
                required
              />
              <label htmlFor="chain-description">Description</label>
              <textarea
                defaultValue={editingChain?.description ?? ""}
                id="chain-description"
                name="description"
                placeholder="What will this recipe help you make?"
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
                      : "Create recipe"}
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
              <h3>Your recipe box is empty</h3>
              <p>Create your first prompt recipe, then add its instructions and AI model.</p>
              <button className="secondary-create-button" onClick={openCreateForm}>
                Create your first recipe
              </button>
            </div>
          ) : (
            <div className="chain-card-grid">
              {chains.map((chain, index) => (
                <article className="chain-card" key={chain.id}>
                  <Link
                    className="chain-card-link"
                    href={`/dashboard/chains/${chain.id}`}
                    aria-label={`Open ${chain.name}`}
                  >
                    <span className="chain-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="chain-details">
                      <h3>{chain.name || "Untitled prompt chain"}</h3>
                      <p>{chain.description || "No description provided."}</p>
                      <span className="chain-step-count">
                        {chain.stepCount === null
                          ? "Step count unavailable"
                          : `${chain.stepCount} ${chain.stepCount === 1 ? "instruction" : "instructions"}`}
                      </span>
                    </div>
                    <svg
                      aria-hidden="true"
                      className="chain-card-arrow"
                      viewBox="0 0 20 20"
                      fill="none"
                    >
                      <path d="M4 10h12m-5-5 5 5-5 5" />
                    </svg>
                  </Link>
                  <div className="chain-card-actions">
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
        </>
      )}
    </section>
  );
}
