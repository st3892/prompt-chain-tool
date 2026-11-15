import { redirect } from "next/navigation";
import Link from "next/link";
import { AccessDenied } from "@/components/access-denied";
import { signOut } from "@/app/actions";
import { PromptChainManager } from "@/components/prompt-chain-manager";
import type { PromptChain } from "@/lib/prompt-chains";
import { getDatabaseErrorMessage } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BakeryMark } from "@/components/bakery-mark";

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

  const chains: (PromptChain & { stepCount: number | null })[] =
    await Promise.all(
      (chainRows ?? []).map(async (chain) => {
        const { count, error: countError } = await supabase
          .from("prompt_chain_steps")
          .select("id", { count: "exact", head: true })
          .eq("prompt_chain_id", chain.id);

        if (countError) {
          console.error("Unable to count prompt-chain steps.", countError);
        }

        return {
          id: String(chain.id),
          name: chain.name,
          description: chain.description,
          stepCount: countError ? null : count,
        };
      }),
    );
  const chainsLoadError = chainsError
    ? getDatabaseErrorMessage(chainsError)
    : null;

  if (chainsError) {
    console.error("Unable to load prompt chains.", chainsError);
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link className="brand-lockup dashboard-brand" href="/" aria-label="Prompt Chain Tool">
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

      <section className="dashboard-content">
        <div className="dashboard-welcome">
          <p className="eyebrow">YOUR BAKING WORKSPACE</p>
          <h1>Prompt Chain Tool</h1>
          <p className="welcome-copy">
            Welcome{user.email ? `, ${user.email}` : ""}. Your admin apron is
            on and the kitchen is ready.
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
            <p className="eyebrow">THE RECIPE BOOK</p>
            <h2>Build and manage prompt recipes</h2>
            <p>
              Create prompt chains, arrange their instructions, and run them
              with your connected AI models.
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
        />
      </section>
      <footer className="dashboard-footer">
        <span>Prompt Chain Tool</span>
        <span>Whisk Takers · A secure recipe kitchen</span>
      </footer>
    </main>
  );
}
