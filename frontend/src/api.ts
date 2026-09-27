import type {
  Alert,
  Community,
  CommunityResponse,
  Contact,
  Demo,
  DetailResponse,
  DeviceLearning,
  Device,
  DevicesResponse,
  LoginResponse,
  MotionSensitivity,
  FamilyNotify,
  Place,
  Resident,
  ResidentSummary,
  User,
  Weather,
} from "./types";
import { LOGOUT_EVENT, loadSession, saveSession } from "./session";
// Production uses the same-origin backend; local development defaults to fixtures.
// An explicit flag overrides the default. Never fall back to fixtures on API errors.
export const useMock =
  import.meta.env.VITE_USE_MOCK === "true" ||
  (import.meta.env.VITE_USE_MOCK !== "false" && !import.meta.env.PROD);
/** A failed API response, with its HTTP status for callers that react to specific codes. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (useMock) return (await import("./mock")).mockRequest(path, method, body) as Promise<T>;
  const token = loadSession()?.token;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 && token) {
    // The login expired or the server restarted with a new key: send the user back to log in.
    saveSession(null);
    window.dispatchEvent(new Event(LOGOUT_EVENT));
  }
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      typeof error === "object" &&
        error !== null &&
        "detail" in error &&
        typeof error.detail === "string"
        ? error.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>("/auth/login", "POST", { email, password }),
  me: () => request<{ user: User }>("/auth/me"),
  residents: () => request<Resident[]>("/residents"),
  community: () => request<CommunityResponse>("/community"),
  updateCommunity: (body: Partial<Omit<Community, "id" | "name">>) =>
    request<Community>("/community", "PATCH", body),
  places: (query: string) => request<Place[]>(`/places?query=${encodeURIComponent(query)}`),
  simulateWeather: (kind: Weather["kind"] | null) =>
    request<{ weather: Weather | null }>("/community/weather/simulate", "POST", { kind }),
  residentSummary: (id: string) =>
    request<ResidentSummary>(`/residents/${encodeURIComponent(id)}/summary`),
  markOkay: (residentId: string) =>
    request<Resident>(`/residents/${encodeURIComponent(residentId)}/okay`, "POST"),
  acknowledge: (id: number) => request<Alert>(`/alerts/${id}/acknowledge`, "POST"),
  updateResident: (
    id: string,
    body: {
      share_alerts_with_family?: boolean;
      share_activity_with_family?: boolean;
      family_notify?: FamilyNotify;
    },
  ) => request<Resident>(`/residents/${encodeURIComponent(id)}`, "PATCH", body),
  devices: () => request<DevicesResponse>("/devices"),
  device: (id: string) => request<DetailResponse>(`/devices/${encodeURIComponent(id)}`),
  updateDevice: (
    id: string,
    body: {
      name?: string;
      limit_minutes?: number;
      sound_enabled?: boolean;
      motion_sensitivity?: MotionSensitivity;
    },
  ) =>
    request<{ server_now: string; device: Device }>(
      `/devices/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    ),
  resolve: (id: number) => request<{ ok: boolean }>(`/alerts/${id}/resolve`, "POST"),
  contacts: () => request<Contact[]>("/contacts"),
  addContact: (body: { name: string; phone: string }) =>
    request<Contact>("/contacts", "POST", body),
  deleteContact: (id: number) => request<void>(`/contacts/${id}`, "DELETE"),
  testContact: (id: number) =>
    request<{ ok: boolean; channel: "sms" | "email" }>(`/contacts/${id}/test`, "POST"),
  demo: () => request<Demo>("/demo"),
  setDemo: (body: { enabled: boolean; time_scale?: number; start_clock_at?: string }) =>
    request<Demo>("/demo", "POST", body),
  seed: (device_id: string) =>
    request<{ ok: boolean; events_created: number }>("/demo/seed", "POST", {
      device_id,
    }),
  learning: (id: string, source: "auto" | "real" | "sample" = "auto") =>
    request<DeviceLearning>(`/devices/${encodeURIComponent(id)}/learning?source=${source}`),
  reset: () => request<{ ok: boolean }>("/demo/reset", "POST"),
};
