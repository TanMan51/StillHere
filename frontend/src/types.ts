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
  resolved_by: "motion" | "reply" | "family" | "staff" | "heartbeat" | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  escalation_level: number;
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
  resident_id: string | null;
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
  resident_id: string | null;
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
export type Role = "family" | "provider";
export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  community_id: string | null;
  community_name: string | null;
  resident_id: string | null;
}
export interface LoginResponse {
  token: string;
  user: User;
}
export interface Resident {
  id: string;
  community_id: string | null;
  first_name: string;
  last_name: string;
  floor: number | null;
  unit: string | null;
  share_alerts_with_family: boolean;
  share_activity_with_family: boolean;
  family_notify: FamilyNotify;
  marked_okay_at: string | null;
  marked_okay_by: string | null;
  device_ids: string[];
}
export type FamilyNotify = "immediately" | "if_unanswered";
export type UnitState = "fine" | "watch" | "worry" | "offline" | "urgent";
export interface Community {
  id: string;
  name: string;
  watch_after_minutes: number;
  worry_after_minutes: number;
  on_call_phone: string | null;
  escalate_after_minutes: number;
  checkin_time: string;
  latitude: number | null;
  longitude: number | null;
  location_name: string | null;
}
export interface Conditions {
  temperature_f: number | null;
  feels_like_f: number | null;
  description: string | null;
  observed_at: string | null;
}
export interface Place {
  name: string;
  latitude: number;
  longitude: number;
}
export interface Weather {
  id: string;
  event: string;
  kind: "heat" | "cold";
  headline: string | null;
  ends_at: string | null;
  source: "nws" | "simulated";
  watch_after_minutes: number;
  worry_after_minutes: number;
}
export interface Unit {
  resident_id: string;
  first_name: string;
  last_name: string;
  floor: number | null;
  unit: string | null;
  state: UnitState;
  minutes_since_motion: number | null;
  last_motion_at: string | null;
  last_event: { type: MotionEvent["type"]; value: string | null; ts: string } | null;
  online: boolean;
  last_heartbeat_at: string | null;
  device_id: string | null;
  device_status: Status | null;
  active_alert: Alert | null;
  activity_lower_than_usual: boolean;
}
export interface ResponseTimes {
  alerts: number;
  acknowledged: number;
  average_acknowledge_seconds: number | null;
  average_resolve_seconds: number | null;
}
export interface CommunityResponse {
  server_now: string;
  community: Community;
  units: Unit[];
  checkin: {
    time: string;
    reason: "morning" | "weather";
    since: string;
    resident_ids: string[];
  };
  weather: Weather | null;
  conditions: Conditions | null;
  response_times: ResponseTimes;
}
export interface Trend {
  days: { date: string; count: number }[];
  recent_daily_average: number | null;
  prior_daily_average: number | null;
  lower_than_usual: boolean;
  note: string | null;
}
export interface ResidentSummary {
  server_now: string;
  resident: Resident;
  community_name: string | null;
  timezone: string;
  unit: Unit | null;
  devices: {
    id: string;
    name: string;
    object_type: Device["object_type"];
    status: Status;
    online: boolean;
  }[];
  trend: Trend | null;
  alerts: Alert[];
  response_times: ResponseTimes;
}
