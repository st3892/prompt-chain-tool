"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BakeryMark } from "@/components/bakery-mark";

export function LoginForm({ oauthError = false }: { oauthError?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(
    oauthError ? "Google sign-in could not be completed. Please try again." : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  async function handleGoogleSignIn() {
    setErrorMessage("");
    setIsGoogleSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setErrorMessage(error.message);
        setIsGoogleSubmitting(false);
      }
    } catch (error) {
      console.error("Unable to start Google sign-in.", error);
      setErrorMessage("Unable to start Google sign-in. Please try again.");
      setIsGoogleSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      console.error("Unable to sign in.", error);
      setErrorMessage("Unable to sign in right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <div className="login-orbit login-orbit-one" aria-hidden="true" />
      <div className="login-orbit login-orbit-two" aria-hidden="true" />
      <section className="login-panel">
        <div className="login-topline">
          <Link className="brand-lockup" href="/" aria-label="Prompt Chain Tool home">
            <BakeryMark />
            <span className="brand-copy">
              <strong>Whisk Takers</strong>
              <small>Prompt Chain Tool</small>
            </span>
          </Link>
          <ThemeSwitcher />
        </div>

        <div className="login-intro">
          <p className="eyebrow">WELCOME TO THE KITCHEN</p>
          <h1>Welcome back</h1>
          <p>Sign in to prepare and manage your prompt-chain recipes.</p>
        </div>

        <button
          className="google-button"
          disabled={isSubmitting || isGoogleSubmitting}
          onClick={handleGoogleSignIn}
          type="button"
        >
          {isGoogleSubmitting ? (
            <span className="google-loading-dot" aria-hidden="true" />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 48 48">
              <path
                fill="#4285F4"
                d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15Z"
              />
              <path
                fill="#34A853"
                d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5.1c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20 20 0 0 0 24 44Z"
              />
              <path
                fill="#FBBC05"
                d="M12.6 27.7a12 12 0 0 1 0-7.4V15H5.8a20 20 0 0 0 0 18l6.8-5.3Z"
              />
              <path
                fill="#EA4335"
                d="M24 12c3 0 5.7 1 7.8 3.1l5.9-5.9C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15l6.8 5.3C14.2 15.6 18.7 12 24 12Z"
              />
            </svg>
          )}
          {isGoogleSubmitting ? "Connecting to Google..." : "Continue with Google"}
        </button>

        <div className="login-divider" aria-hidden="true">
          <span />
          <span>or continue with email</span>
          <span />
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Email address</label>
          <input
            autoComplete="email"
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />

          <div className="password-label">
            <label htmlFor="password">Password</label>
          </div>
          <input
            autoComplete="current-password"
            id="password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
            type="password"
            value={password}
          />

          {errorMessage && (
            <p className="form-error" role="alert">
              {errorMessage}
            </p>
          )}

          <button
            className="primary-button login-button"
            disabled={isSubmitting || isGoogleSubmitting}
          >
            {isSubmitting ? "Signing in..." : "Sign in"}
            {!isSubmitting && (
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
                <path d="M4 10h12m-5-5 5 5-5 5" />
              </svg>
            )}
          </button>
        </form>

        <p className="login-footnote">
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
            <rect x="4" y="8.5" width="12" height="9" rx="2" />
            <path d="M6.5 8.5V6a3.5 3.5 0 1 1 7 0v2.5" />
          </svg>
          Secure sign-in for authorized administrators
        </p>
      </section>
      <p className="login-copyright">Mixing better prompts, one recipe at a time.</p>
    </main>
  );
}
