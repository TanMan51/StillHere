export type Status =
  "ok" | "inactive_alert" | "urgent" | "awaiting_reply" | "offline" | "no_reply_alert";
export type MotionSensitivity = "low" | "medium" | "high";
export interface Alert {
  id: number;
  device_id: string;
  kind: "inactivity" | "urgent" | "no_reply" | "false_alarm" | "offline" | "all_clear";
  message: string;
  sms_sent: boolean;
  sent_at: string;
  resolved_at: string | null;
  resolved_by: "motion" | "reply" | "family" | "heartbeat" | null;
}
export interface Device {
  id: string;
  name: string;
  object_type: "fridge" | "walker" | "door" | "other";
  status: Status;
  status_since: string;
  online: boolean;
  last_motion_at: string | null;
  last_heartbeat_at: string | null;
  limit_minutes: number;
  next_alert_at: string | null;
  seconds_until_alert: number | null;
  routine_note: string | null;
  active_alert: Alert | null;
  sound_enabled: boolean;
  motion_sensitivity: MotionSensitivity;
}
export interface MotionEvent {
  id: number;
  type: "motion" | "loud" | "reply" | "fall" | "heartbeat";
  value: string | null;
  level: number | null;
  ts: string;
}
export interface Baseline {
  ready: boolean;
  days_of_data: number;
  timezone: string;
  hourly_activity: number[];
  hourly_threshold_minutes: number[];
}
export interface DeviceDetail extends Device {
  events: MotionEvent[];
  alerts: Alert[];
  baseline: Baseline;
}
export interface Contact {
  id: number;
  name: string;
  phone: string;
  created_at: string;
}
export interface Demo {
  enabled: boolean;
  time_scale: number;
  clock_started_at: string | null;
  server_now: string;
}
export interface DevicesResponse {
  server_now: string;
  devices: Device[];
}
export interface DetailResponse {
  server_now: string;
  device: DeviceDetail;
}
