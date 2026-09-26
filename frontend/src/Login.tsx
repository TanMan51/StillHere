import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMock } from "./api";

const DEMO_EMAIL = "demo@stillhere.example";
const DEMO_PASSWORD = "stillhere-demo";
const SESSION_KEY = "stillhere-demo-session";

export function hasDemoSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === "active";
  } catch {
    return false;
  }
}

export function saveDemoSession(active: boolean): void {
  // This flag is only for navigating the demo. It does not authorize API requests.
  try {
    if (active) sessionStorage.setItem(SESSION_KEY, "active");
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* In-memory navigation still works when browser storage is unavailable. */
  }
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!useMock) return;
    if (
      email.trim().toLowerCase() !== DEMO_EMAIL ||
      password !== DEMO_PASSWORD
    ) {
      setError("Use the demo email and password shown below.");
      return;
    }
    setPassword("");
    onLogin();
  }

  return (
    <section className="panel login-panel" aria-labelledby="login-title">
      <h1 id="login-title">Log in</h1>
      <p>
        {useMock
          ? "Log in to view the sample devices and alerts."
          : "Account login is not available yet."}
      </p>
      {useMock ? (
        <>
          <form onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
              }}
            />
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button type="submit">Log in</button>
          </form>
          <aside className="login-demo" aria-label="Demo credentials">
            <h2>Demo login</h2>
            <p>
              Email: <code>{DEMO_EMAIL}</code>
              <br />
              Password: <code>{DEMO_PASSWORD}</code>
            </p>
            <p>
              This login is for sample data only. Do not enter a personal
              password.
            </p>
          </aside>
        </>
      ) : (
        <>
          <p>
            The dashboard currently has public access. This page does not secure
            it.
          </p>
          <Link className="back" to="/dashboard">
            Open dashboard
          </Link>
        </>
      )}
    </section>
  );
}
