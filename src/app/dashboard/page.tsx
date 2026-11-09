import { redirect } from "next/navigation";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { signOut } from "@/app/actions";
import { PromptChainManager } from "@/components/prompt-chain-manager";
import type { PromptChain } from "@/lib/prompt-chains";
import type { LlmModel } from "@/lib/prompt-chain-steps";
import { getDatabaseErrorMessage } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // Check admin access on the server before rendering any dashboard content.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Unable to verify the user's admin profile.", error);
    return (
      <AccessDenied message="We could not verify your admin access. Please contact your project administrator." />
    );
  }

  if (profile?.is_superadmin !== true) {
    redirect("/access-denied");
  }

  const { data: chainRows, error: chainsError } = await supabase
    .from("prompt_chains")
    .select("id, name, description")
    .order("id", { ascending: true });
  const { data: modelRows, error: modelsError } = await supabase
    .from("llm_models")
    .select("id, name, supports_temperature")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const chains: PromptChain[] = (chainRows ?? []).map((chain) => ({
    id: String(chain.id),
    name: chain.name,
    description: chain.description,
  }));
  const chainsLoadError = chainsError
    ? getDatabaseErrorMessage(chainsError)
    : null;
  const models: LlmModel[] = (modelRows ?? []).map((model) => ({
    id: String(model.id),
    name: model.name,
    supports_temperature: model.supports_temperature,
  }));
  const modelsLoadError = modelsError
    ? getDatabaseErrorMessage(modelsError, "llm_models")
    : null;

  if (chainsError) {
    console.error("Unable to load prompt chains.", chainsError);
  }
  if (modelsError) {
    console.error("Unable to load active AI models.", modelsError);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link className="brand-lockup dashboard-brand" href="/" aria-label="Prompt Chain Tool">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 9h12a5 5 0 0 1 0 10h-2" />
              <path d="m13 15 4 4-4 4" />
              <path d="M25 23H13a5 5 0 0 1 0-10h2" />
              <path d="m19 17-4-4 4-4" />
            </svg>
          </span>
          <span>Prompt Chain Tool</span>
        </Link>
        <div className="header-actions">
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

      <section className="dashboard-content">
        <div className="dashboard-welcome">
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Prompt Chain Tool</h1>
          <p className="welcome-copy">
            Welcome{user.email ? `, ${user.email}` : ""}. You’re signed in with
            administrator access.
          </p>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7 7h10m-10 5h10m-10 5h6" />
              <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
            </svg>
          </div>
          <div>
            <p className="eyebrow">ADMIN DASHBOARD</p>
            <h2>Manage your prompt chains</h2>
            <p>
              Create prompt chains and manage their ordered steps. AI execution
              and generated media are not part of this workspace yet.
            </p>
          </div>
          <span className="status-pill">
            <span />
            Access verified
          </span>
        </div>
        <PromptChainManager
          initialChains={chains}
          loadError={chainsLoadError}
          models={models}
          modelsLoadError={modelsLoadError}
        />
      </section>
      <footer className="dashboard-footer">
        <span>Prompt Chain Tool</span>
        <span>Secure administrator workspace</span>
      </footer>
    </main>
  );
}
