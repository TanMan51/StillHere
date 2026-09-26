import type {
  Contact,
  Demo,
  DetailResponse,
  Device,
  DevicesResponse,
} from "./types";
// Default to fixtures until Person A's server is available. Never silently fall back on API errors.
export const useMock = import.meta.env.VITE_USE_MOCK !== "false";
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (useMock)
    return (await import("./mock")).mockRequest(
      path,
      method,
      body,
    ) as Promise<T>;
  const response = await fetch(`/api${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      typeof error?.detail === "string"
        ? error.detail
        : `Request failed (${response.status})`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export const api = {
  devices: () => request<DevicesResponse>("/devices"),
  device: (id: string) =>
    request<DetailResponse>(`/devices/${encodeURIComponent(id)}`),
  updateDevice: (id: string, body: { name?: string; limit_minutes?: number }) =>
    request<{ server_now: string; device: Device }>(
      `/devices/${encodeURIComponent(id)}`,
      "PATCH",
      body,
    ),
  resolve: (id: number) =>
    request<{ ok: boolean }>(`/alerts/${id}/resolve`, "POST"),
  contacts: () => request<Contact[]>("/contacts"),
  addContact: (body: { name: string; phone: string }) =>
    request<Contact>("/contacts", "POST", body),
  deleteContact: (id: number) => request<void>(`/contacts/${id}`, "DELETE"),
  testContact: (id: number) =>
    request<{ ok: boolean; channel: string }>(`/contacts/${id}/test`, "POST"),
  demo: () => request<Demo>("/demo"),
  setDemo: (body: {
    enabled: boolean;
    time_scale?: number;
    start_clock_at?: string;
  }) => request<Demo>("/demo", "POST", body),
  seed: (device_id: string) =>
    request<{ ok: boolean; events_created: number }>("/demo/seed", "POST", {
      device_id,
    }),
  reset: () => request<{ ok: boolean }>("/demo/reset", "POST"),
};
