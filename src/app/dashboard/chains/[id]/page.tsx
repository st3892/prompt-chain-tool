import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessDenied } from "@/components/access-denied";
import {
  GenerationHistory,
  type GenerationHistoryItem,
} from "@/components/generation-history";
import { PromptChainRunner } from "@/components/prompt-chain-runner";
import { PromptChainStepsManager } from "@/components/prompt-chain-steps-manager";
import { signOut } from "@/app/actions";
import type { PromptChain } from "@/lib/prompt-chains";
import type { LlmModel, PromptChainStep } from "@/lib/prompt-chain-steps";
import { getDatabaseErrorMessage } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BakeryMark } from "@/components/bakery-mark";

export default async function PromptChainDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/");
  }

  // Verify administrator access before reading chain or step details.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to verify the user's admin profile.", profileError);
    return (
      <AccessDenied message="We could not verify your admin access. Please contact your project administrator." />
    );
  }
  if (profile?.is_superadmin !== true) {
    redirect("/access-denied");
  }

  const { data: chainRow, error: chainError } = await supabase
    .from("prompt_chains")
    .select("id, name, description")
    .eq("id", id)
    .maybeSingle();

  if (chainError) {
    console.error("Unable to load prompt chain details.", chainError);
    return (
      <AccessDenied message={getDatabaseErrorMessage(chainError)} />
    );
  }
  if (!chainRow) notFound();

  const [stepsResult, modelsResult] = await Promise.all([
    supabase
      .from("prompt_chain_steps")
      .select(
        "id, prompt_chain_id, step_order, name, prompt_template, llm_model_id, temperature, created_at",
      )
      .eq("prompt_chain_id", id)
      .order("step_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("llm_models")
      .select("id, name, supports_temperature")
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  if (stepsResult.error) {
    console.error("Unable to load prompt-chain steps.", stepsResult.error);
  }
  if (modelsResult.error) {
    console.error("Unable to load active AI models.", modelsResult.error);
  }

  const chain: PromptChain = {
    id: String(chainRow.id),
    name: chainRow.name,
    description: chainRow.description,
  };
  const initialSteps: PromptChainStep[] = (stepsResult.data ?? []).map(
    (step) => ({
      id: String(step.id),
      prompt_chain_id: String(step.prompt_chain_id),
      step_order: step.step_order,
      name: step.name,
      prompt_template: step.prompt_template,
      llm_model_id: String(step.llm_model_id),
      temperature: step.temperature === null ? null : Number(step.temperature),
      created_at: step.created_at,
    }),
  );
  const models: LlmModel[] = (modelsResult.data ?? []).map((model) => ({
    id: String(model.id),
    name: model.name,
    // Treat only the database boolean true as support; string "false" is truthy in JavaScript.
    supports_temperature: model.supports_temperature === true,
  }));

  const { data: requestRows, error: historyRequestError } = await supabase
    .from("generation_requests")
    .select("id, status, created_at, completed_at")
    .eq("prompt_chain_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(25);

  let historyItems: GenerationHistoryItem[] = [];
  let historyError = historyRequestError
    ? getDatabaseErrorMessage(historyRequestError, "generation_requests")
    : null;

  if (historyRequestError) {
    console.error("Unable to load prompt-chain generation history.", {
      code: historyRequestError.code,
    });
  } else if (requestRows?.length) {
    const requestIds = requestRows.map((request) => request.id);
    const { data: responseRows, error: responsesError } = await supabase
      .from("llm_responses")
      .select(
        "id, generation_request_id, prompt_chain_step_id, response_text, latency_ms, created_at",
      )
      .in("generation_request_id", requestIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (responsesError) {
      historyError = getDatabaseErrorMessage(responsesError, "llm_responses");
      console.error("Unable to load saved prompt-chain step outputs.", {
        code: responsesError.code,
      });
    } else {
      const stepById = new Map(
        (stepsResult.data ?? []).map((step) => [
          String(step.id),
          step.name,
        ]),
      );
      const responsesByRequest = new Map<
        string,
        NonNullable<typeof responseRows>
      >();

      for (const response of responseRows ?? []) {
        if (response.generation_request_id === null) continue;
        const key = String(response.generation_request_id);
        const rows = responsesByRequest.get(key) ?? [];
        rows.push(response);
        responsesByRequest.set(key, rows);
      }

      historyItems = requestRows.map((request) => {
        const outputs = (responsesByRequest.get(String(request.id)) ?? [])
          .map((response, index) => {
            const stepId =
              response.prompt_chain_step_id === null
                ? null
                : String(response.prompt_chain_step_id);
            const stepName = stepId ? stepById.get(stepId) : undefined;
            return {
              id: String(response.id),
              stepId,
              stepOrder: index + 1,
              stepName: stepName ?? "Step no longer available",
              output: response.response_text ?? "",
              latencyMs: response.latency_ms,
            };
          });

        return {
          id: String(request.id),
          status: request.status,
          createdAt: request.created_at,
          completedAt: request.completed_at,
          outputs,
        };
      });
    }
  }

  const stepsLoadError = stepsResult.error
    ? getDatabaseErrorMessage(stepsResult.error, "prompt_chain_steps")
    : null;
  const modelsLoadError = modelsResult.error
    ? getDatabaseErrorMessage(modelsResult.error, "llm_models")
    : null;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link
          className="brand-lockup dashboard-brand"
          href="/"
          aria-label="Prompt Chain Tool"
        >
          <BakeryMark />
          <span className="brand-copy">
            <strong>Whisk Takers</strong>
            <small>Prompt Chain Tool</small>
          </span>
        </Link>
        <div className="header-actions">
          <ThemeSwitcher />
          <span className="admin-indicator">
            <span />
            Admin workspace
          </span>
          <form action={signOut}>
            <button className="logout-button" type="submit">
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M8 3H4.5A1.5 1.5 0 0 0 3 4.5v11A1.5 1.5 0 0 0 4.5 17H8" />
                <path d="M12 14l4-4-4-4m4 4H7" />
              </svg>
              Log out
            </button>
          </form>
        </div>
      </header>

      <section className="dashboard-content chain-detail-content">
        <Link className="back-to-chains" href="/dashboard">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <path d="M16 10H4m5 5-5-5 5-5" />
          </svg>
          Back to the Recipe Book
        </Link>
        <div className="dashboard-welcome chain-detail-welcome">
          <p className="eyebrow">TODAY’S RECIPE</p>
          <h1>{chain.name}</h1>
          <p className="welcome-copy">
            {chain.description || "No description provided."}
          </p>
        </div>
        <PromptChainRunner chainId={chain.id} chainName={chain.name} />
        <GenerationHistory items={historyItems} error={historyError} />
        <PromptChainStepsManager
          chain={chain}
          initialSteps={initialSteps}
          models={models}
          modelsLoadError={modelsLoadError}
          stepsLoadError={stepsLoadError}
        />
      </section>
      <footer className="dashboard-footer">
        <span>Prompt Chain Tool</span>
        <span>Whisk Takers · A secure recipe kitchen</span>
      </footer>
    </main>
  );
}
