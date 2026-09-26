import { describe, expect, it } from "vitest";
import { elapsed } from "./Community";

describe("elapsed", () => {
  it("shows minutes, hours and minutes, then days", () => {
    expect(elapsed(45)).toBe("45m");
    expect(elapsed(192)).toBe("3h 12m");
    expect(elapsed(60 * 50 + 5)).toBe("2d 2h");
  });
  it("says when nothing has moved", () => {
    expect(elapsed(null)).toBe("No movement yet");
  });
});
