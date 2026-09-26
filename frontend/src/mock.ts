import deviceFixture from "../../contract/fixtures/devices.json";
import detailFixture from "../../contract/fixtures/device_detail.json";
import contactFixture from "../../contract/fixtures/contacts.json";
import type { Baseline, Contact, Demo, Device, DeviceDetail } from "./types";

// Stateful, in-memory fixtures: edits survive polling, but a reload restores the demo.
let contacts = structuredClone(contactFixture) as Contact[];
let nextContact = 3;
let clockAnchor = Date.parse(deviceFixture.server_now);
let realAnchor = Date.now();
let demo: Demo = {
  enabled: false,
  time_scale: 1,
  clock_started_at: null,
  server_now: deviceFixture.server_now,
};
const now = () =>
  new Date(
    clockAnchor + (Date.now() - realAnchor) * demo.time_scale,
  ).toISOString();
const emptyBaseline = (): Baseline => ({
  ready: false,
  days_of_data: 0,
  timezone: "America/New_York",
  hourly_activity: Array(24).fill(0),
  hourly_threshold_minutes: Array(24).fill(0),
});
const devices: DeviceDetail[] = (
  structuredClone(deviceFixture.devices) as Device[]
).map((d) => ({
  ...d,
  events: [],
  alerts: d.active_alert ? [d.active_alert] : [],
  baseline: emptyBaseline(),
}));
const detailIndex = devices.findIndex(
  (device) => device.id === detailFixture.device.id,
);
if (detailIndex >= 0)
  devices[detailIndex] = structuredClone(detailFixture.device) as DeviceDetail;

export async function mockRequest(
  path: string,
  method: string,
  raw?: unknown,
): Promise<unknown> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const parts = path.split("/").filter(Boolean);
  const server_now = now();
  const response = (value: unknown) => structuredClone(value);
  for (const d of devices) {
    d.seconds_until_alert = d.next_alert_at
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(d.next_alert_at) - Date.parse(server_now)) /
              1000 /
              demo.time_scale,
          ),
        )
      : null;
  }
  if (path === "/devices") return response({ server_now, devices });
  if (parts[0] === "devices") {
    const device = devices.find((d) => d.id === decodeURIComponent(parts[1]));
    if (!device) throw new Error("Device not found");
    if (method === "PATCH") {
      if (typeof body.name === "string") device.name = body.name;
      if (typeof body.limit_minutes === "number")
        device.limit_minutes = body.limit_minutes;
    }
    return response({ server_now, device });
  }
  if (parts[0] === "alerts" && parts[2] === "resolve") {
    const device = devices.find((d) => d.active_alert?.id === Number(parts[1]));
    if (!device) throw new Error("Active alert not found");
    const alert = device.alerts.find((a) => a.id === Number(parts[1]));
    if (alert) {
      alert.resolved_at = server_now;
      alert.resolved_by = "family";
    }
    device.active_alert = null;
    device.status = device.online ? "ok" : "offline";
    device.routine_note = null;
    return { ok: true };
  }
  if (path === "/contacts" && method === "GET") return response(contacts);
  if (path === "/contacts" && method === "POST") {
    const contact = {
      id: nextContact++,
      name: String(body.name),
      phone: String(body.phone),
      created_at: server_now,
    };
    contacts.push(contact);
    return response(contact);
  }
  if (parts[0] === "contacts" && method === "DELETE") {
    contacts = contacts.filter((c) => c.id !== Number(parts[1]));
    return;
  }
  if (parts[0] === "contacts" && parts[2] === "test")
    return { ok: true, channel: "sms" };
  if (path === "/demo") {
    if (method === "POST") {
      clockAnchor = Date.parse(
        typeof body.start_clock_at === "string"
          ? body.start_clock_at
          : server_now,
      );
      realAnchor = Date.now();
      demo = {
        enabled: Boolean(body.enabled),
        time_scale: body.enabled ? Number(body.time_scale ?? 1440) : 1,
        clock_started_at: body.enabled
          ? new Date(clockAnchor).toISOString()
          : null,
        server_now: now(),
      };
    }
    return response({ ...demo, server_now: now() });
  }
  if (path === "/demo/seed") {
    const device = devices.find((d) => d.id === body.device_id);
    if (!device) throw new Error("Device not found");
    device.baseline = {
      ...structuredClone(detailFixture.device.baseline),
      days_of_data: 7,
    };
    device.events = Array.from({ length: 42 }, (_, i) => ({
      id: 10000 + i,
      type: "motion" as const,
      value: null,
      level: 1.5,
      ts: new Date(
        Date.parse(server_now) - (i + 1) * 4 * 3600000,
      ).toISOString(),
    }));
    device.last_motion_at = device.events[0].ts;
    return { ok: true, events_created: 42 };
  }
  if (path === "/demo/reset") {
    devices.forEach((d) => {
      d.events = [];
      d.alerts = [];
      d.active_alert = null;
      d.status = "ok";
      d.routine_note = null;
      d.last_motion_at = null;
      d.next_alert_at = null;
      d.seconds_until_alert = null;
      d.baseline = emptyBaseline();
    });
    return { ok: true };
  }
  throw new Error(`Mock endpoint not implemented: ${method} ${path}`);
}
