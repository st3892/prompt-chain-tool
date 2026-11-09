"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        <Link className="brand-lockup" href="/" aria-label="Prompt Chain Tool home">
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

        <div className="login-intro">
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Welcome back</h1>
          <p>Sign in to manage your Prompt Chain Tool workspace.</p>
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

          <button className="primary-button login-button" disabled={isSubmitting}>
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
      <p className="login-copyright">A focused space for building better prompts.</p>
    </main>
  );
}
