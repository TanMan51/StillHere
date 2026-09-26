import { describe, expect, it } from "vitest";
import { localHour, todayByHour } from "./activity";
import type { MotionEvent } from "./types";

// 10:15 AM on Sept 26 in New York.
const NOW = "2026-09-26T14:15:00Z";
const TZ = "America/New_York";
let nextId = 1;
const event = (ts: string, type: MotionEvent["type"] = "motion"): MotionEvent => ({
  id: nextId++,
  type,
  value: null,
  level: null,
  ts,
});

describe("today by hour", () => {
  it("runs from 12 AM to 11 PM of the local day", () => {
    expect(localHour(NOW, TZ)).toBe(10);
    const counts = todayByHour(
      [
        event("2026-09-26T04:05:00Z"), // 12:05 AM today
        event("2026-09-26T14:00:00Z"), // 10:00 AM today
        event("2026-09-26T14:10:00Z"), // 10:10 AM today
      ],
      NOW,
      TZ,
    );
    expect(counts).toHaveLength(24);
    expect(counts[0]).toBe(1);
    expect(counts[10]).toBe(2);
  });

  it("starts fresh at local midnight", () => {
    const counts = todayByHour(
      [
        event("2026-09-26T03:59:00Z"), // 11:59 PM yesterday
        event("2026-09-25T22:30:00Z"), // 6:30 PM yesterday
      ],
      NOW,
      TZ,
    );
    expect(counts.every((count) => count === 0)).toBe(true);
  });

  it("counts only movement and sounds up to now", () => {
    const counts = todayByHour(
      [
        event("2026-09-26T14:20:00Z"), // after now
        event("2026-09-26T13:00:00Z", "reply"),
        event("2026-09-26T13:00:00Z", "heartbeat"),
        event("2026-09-26T13:05:00Z", "loud"),
      ],
      NOW,
      TZ,
    );
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(counts[9]).toBe(1);
  });
});
