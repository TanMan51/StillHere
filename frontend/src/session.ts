import type { User } from "./types";

// The login token and user, kept for this browser tab only. The server checks the token on
// every request; this copy only decides which pages to show.
export interface Session {
  token: string;
  user: User;
}
const SESSION_KEY = "stillhere-session";
export const LOGOUT_EVENT = "stillhere:logout";

export function loadSession(): Session | null {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    return saved ? (JSON.parse(saved) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(session: Session | null): void {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* In-memory navigation still works when browser storage is unavailable. */
  }
}
