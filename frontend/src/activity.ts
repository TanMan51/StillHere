import type { MotionEvent } from "./types";

// Event types that mean someone used the object; replies and heartbeats are not activity.
const ACTIVITY_TYPES = new Set<MotionEvent["type"]>(["motion", "loud"]);

/** Hour of day (0-23) for an ISO timestamp in the household's timezone. */
export function localHour(iso: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      new Date(iso),
    ),
  );
}

/** Calendar date (YYYY-MM-DD) for an ISO timestamp in the household's timezone. */
function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

/**
 * Today's activity events counted by local hour, from 12 AM (index 0) to 11 PM (index 23).
 * The day starts at local midnight, so yesterday's events never appear. Times come from the
 * server (demo clock included), so pass `server_now`, not the browser clock.
 */
export function todayByHour(events: MotionEvent[], now: string, timeZone: string): number[] {
  const today = localDate(now, timeZone);
  const end = Date.parse(now);
  const counts = Array<number>(24).fill(0);
  for (const event of events) {
    if (!ACTIVITY_TYPES.has(event.type) || Date.parse(event.ts) > end) continue;
    if (localDate(event.ts, timeZone) !== today) continue;
    counts[localHour(event.ts, timeZone)]++;
  }
  return counts;
}
