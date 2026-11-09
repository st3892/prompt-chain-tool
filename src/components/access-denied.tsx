import Link from "next/link";

export function AccessDenied({
  message = "Your account does not have permission to access the admin dashboard.",
}: {
  message?: string;
}) {
  return (
    <main className="message-shell">
      <section className="message-card">
        <span className="message-icon denied-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 8v4m0 4h.01" />
            <path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </span>
        <p className="eyebrow">ADMIN AREA</p>
        <h1>Access Denied</h1>
        <p className="message-copy">{message}</p>
        <Link className="secondary-button" href="/">
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
