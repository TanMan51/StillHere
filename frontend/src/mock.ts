import deviceFixture from "../../contract/fixtures/devices.json";
import detailFixture from "../../contract/fixtures/device_detail.json";
import contactFixture from "../../contract/fixtures/contacts.json";
import loginFixture from "../../contract/fixtures/auth_login.json";
import residentFixture from "../../contract/fixtures/residents.json";
import communityFixture from "../../contract/fixtures/community.json";
import summaryFixture from "../../contract/fixtures/resident_summary.json";
import { loadSession } from "./session";
import type {
  Baseline,
  CommunityResponse,
  ResidentSummary,
  Contact,
  Demo,
  Device,
  DeviceDetail,
  Resident,
  User,
} from "./types";

// Stateful, in-memory fixtures: edits survive polling, but a reload restores the demo.
let contacts = structuredClone(contactFixture) as Contact[];
const residents = structuredClone(residentFixture) as Resident[];
const community = structuredClone(communityFixture) as CommunityResponse;
// The same two demo accounts the backend seeds (demo_community.py).
const DEMO_PASSWORD = "stillhere-demo";
const accounts: User[] = [
  {
    id: 1,
    email: "demo@stillhere.example",
    name: "Sam (family)",
    role: "family",
    community_id: null,
    community_name: null,
    resident_id: "mg-204",
  },
  loginFixture.user as User,
];
let nextContact = 3;
let clockAnchor = Date.parse(deviceFixture.server_now);
let realAnchor = Date.now();
let demo: Demo = {
  enabled: false,
  time_scale: 1,
  clock_started_at: null,
  server_now: deviceFixture.server_now,
};
const now = () => new Date(clockAnchor + (Date.now() - realAnchor) * demo.time_scale).toISOString();
const emptyBaseline = (): Baseline => ({
  ready: false,
  days_of_data: 0,
  timezone: "America/New_York",
  hourly_activity: Array(24).fill(0),
  hourly_threshold_minutes: Array(24).fill(0),
});
const devices: DeviceDetail[] = (structuredClone(deviceFixture.devices) as Device[]).map((d) => ({
  ...d,
  events: [],
  alerts: d.active_alert ? [d.active_alert] : [],
  baseline: emptyBaseline(),
}));
const detailIndex = devices.findIndex((device) => device.id === detailFixture.device.id);
if (detailIndex >= 0) devices[detailIndex] = structuredClone(detailFixture.device) as DeviceDetail;

export async function mockRequest(path: string, method: string, raw?: unknown): Promise<unknown> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const parts = path.split("/").filter(Boolean);
  const server_now = now();
  const response = (value: unknown) => structuredClone(value);
  for (const d of devices) {
    d.seconds_until_alert = d.next_alert_at
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(d.next_alert_at) - Date.parse(server_now)) / 1000 / demo.time_scale,
          ),
        )
      : null;
  }
  if (path === "/auth/login") {
    const email = String(body.email).trim().toLowerCase();
    const user = accounts.find((a) => a.email === email);
    if (!user || body.password !== DEMO_PASSWORD) throw new Error("Email or password is incorrect");
    return response({ token: `mock.${user.id}`, user });
  }
  if (path === "/auth/me") {
    const user = loadSession()?.user;
    if (!user) throw new Error("Log in to continue");
    return response({ user });
  }
  if (path === "/residents") {
    const user = loadSession()?.user;
    return response(
      user?.role === "family" ? residents.filter((r) => r.id === user.resident_id) : residents,
    );
  }
  if (parts[0] === "residents" && parts[2] === "summary") {
    // Preview mode has one sample summary; it stands in for every resident.
    return response({ ...(summaryFixture as ResidentSummary), server_now });
  }
  if (parts[0] === "alerts" && parts[2] === "acknowledge") {
    const alert = community.units.find(
      (u) => u.active_alert?.id === Number(parts[1]),
    )?.active_alert;
    if (!alert) throw new Error("Active alert not found");
    alert.acknowledged_at = server_now;
    alert.acknowledged_by = loadSession()?.user.name ?? "Staff";
    return response(alert);
  }
  if (parts[0] === "residents" && method === "PATCH") {
    const resident = residents.find((r) => r.id === decodeURIComponent(parts[1]));
    if (!resident) throw new Error("Resident not found");
    if (typeof body.share_alerts_with_family === "boolean")
      resident.share_alerts_with_family = body.share_alerts_with_family;
    if (typeof body.share_activity_with_family === "boolean")
      resident.share_activity_with_family = body.share_activity_with_family;
    return response(resident);
  }
  if (path === "/community") {
    if (loadSession()?.user.role !== "provider")
      throw new Error("Only healthcare providers can see the community");
    if (method === "PATCH") {
      const watch = Number(body.watch_after_minutes ?? community.community.watch_after_minutes);
      const worry = Number(body.worry_after_minutes ?? community.community.worry_after_minutes);
      if (watch >= worry) throw new Error("The yellow threshold must come before the red one");
      Object.assign(community.community, body, {
        watch_after_minutes: watch,
        worry_after_minutes: worry,
      });
      return response(community.community);
    }
    return response({ ...community, server_now });
  }
  if (path === "/devices") return response({ server_now, devices });
  if (parts[0] === "devices") {
    const device = devices.find((d) => d.id === decodeURIComponent(parts[1]));
    if (!device) throw new Error("Device not found");
    if (method === "PATCH") {
      if (typeof body.name === "string") device.name = body.name;
      if (typeof body.limit_minutes === "number") device.limit_minutes = body.limit_minutes;
      if (typeof body.sound_enabled === "boolean") device.sound_enabled = body.sound_enabled;
      if (
        body.motion_sensitivity === "low" ||
        body.motion_sensitivity === "medium" ||
        body.motion_sensitivity === "high"
      )
        device.motion_sensitivity = body.motion_sensitivity;
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
      resident_id: loadSession()?.user.resident_id ?? null,
    };
    contacts.push(contact);
    return response(contact);
  }
  if (parts[0] === "contacts" && method === "DELETE") {
    contacts = contacts.filter((c) => c.id !== Number(parts[1]));
    return;
  }
  if (parts[0] === "contacts" && parts[2] === "test") return { ok: true, channel: "sms" };
  if (path === "/demo") {
    if (method === "POST") {
      clockAnchor = Date.parse(
        typeof body.start_clock_at === "string" ? body.start_clock_at : server_now,
      );
      realAnchor = Date.now();
      demo = {
        enabled: Boolean(body.enabled),
        time_scale: body.enabled ? Number(body.time_scale ?? 1440) : 1,
        clock_started_at: body.enabled ? new Date(clockAnchor).toISOString() : null,
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
      ts: new Date(Date.parse(server_now) - (i + 1) * 4 * 3600000).toISOString(),
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
