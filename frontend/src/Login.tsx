import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { saveSession, type Session } from "./session";
import type { Role } from "./types";

// Seeded demo accounts (backend demo_community.py). They hold invented data only.
const DEMO_ACCOUNTS: Record<Role, { label: string; email: string }> = {
  family: { label: "Family caregiver", email: "demo@stillhere.example" },
  provider: { label: "Healthcare provider", email: "staff@maplegrove.example" },
};
const DEMO_PASSWORD = "stillhere-demo";

export default function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [role, setRole] = useState<Role>("family");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api.login(email.trim(), password);
      if (session.user.role !== role) {
        setError(
          `This is a ${DEMO_ACCOUNTS[session.user.role].label.toLowerCase()} account. ` +
            `Choose "${DEMO_ACCOUNTS[session.user.role].label}" above.`,
        );
        return;
      }
      setPassword("");
      saveSession(session);
      onLogin(session);
    } catch (e) {
      // 404/405 means the server predates accounts (an older deployment), not a bad password.
      const outdated = e instanceof ApiError && (e.status === 404 || e.status === 405);
      setError(
        outdated
          ? "This server doesn't support logins yet. It may be running an older version of StillHere."
          : e instanceof Error
            ? e.message
            : "Login failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel login-panel" aria-labelledby="login-title">
      <h1 id="login-title">Log in</h1>
      <p>
        {role === "family"
          ? "Follow the person you care for: their activity, alerts, and check-ins."
          : "See every resident in your community at a glance."}
      </p>
      <form onSubmit={submit}>
        <fieldset className="role-choice">
          <legend>I am a</legend>
          {(Object.keys(DEMO_ACCOUNTS) as Role[]).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => {
                  setRole(value);
                  setError("");
                }}
              />
              {DEMO_ACCOUNTS[value].label}
            </label>
          ))}
        </fieldset>
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
        <button type="submit" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <aside className="login-demo" aria-label="Demo credentials">
        <h2>Demo login: {DEMO_ACCOUNTS[role].label.toLowerCase()}</h2>
        <p>
          Email: <code>{DEMO_ACCOUNTS[role].email}</code>
          <br />
          Password: <code>{DEMO_PASSWORD}</code>
        </p>
        <p>This login is for sample data only. Do not enter a personal password.</p>
      </aside>
    </section>
  );
}
