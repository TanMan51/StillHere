import { describe, expect, it } from "vitest";
import {
  comparePlacementContext,
  placementResult,
  questionsForPlacement,
} from "./placement";
import { placementRisks, riskCost } from "./placementRisks";

describe("placement decisions", () => {
  it("never recommends an incomplete or unsuitable spot", () => {
    expect(placementResult({ name: "Shelf", answers: {} }).rank).toBe(0);
    expect(
      placementResult({ name: "Loose attachment", answers: { secure: false } })
        .rank,
    ).toBe(0);
    expect(
      placementResult({
        name: "Shelf",
        answers: { secure: true, moves: false },
      }).rank,
    ).toBe(0);
    expect(
      placementResult({
        name: "Guest room door",
        answers: { secure: true, moves: true, daily: false },
      }).rank,
    ).toBe(0);
  });
  it("ranks personal daily use above shared use without discarding shared options", () => {
    const answers = { secure: true, moves: true, daily: true };
    const shared = placementResult({
      name: "Shared door",
      answers: { ...answers, personal: false },
    });
    const personal = placementResult({
      name: "Personal drawer",
      answers: { ...answers, personal: true },
    });
    expect(shared.rank).toBeGreaterThan(0);
    expect(personal.rank).toBeGreaterThan(shared.rank);
    expect(shared.reason).toContain("shared use");
  });
});

describe("contextual placement comparison", () => {
  it("prioritizes the stated routine over unrelated frequent activity", () => {
    const context = {
      Fridge: {
        routine: "Breakfast",
        relevance: "2",
        consistency: "1",
        frequency: "1",
      },
      Door: {
        routine: "Shared entrances",
        relevance: "0",
        consistency: "2",
        frequency: "2",
      },
    };
    expect(comparePlacementContext(["Door", "Fridge"], context)).toEqual([
      "Fridge",
    ]);
  });
  it("preserves genuine ties for a contextual follow-up instead of choosing by order", () => {
    const detail = {
      routine: "Morning use",
      relevance: "2",
      consistency: "2",
      frequency: "1",
    };
    expect(
      comparePlacementContext(["A", "B"], { A: detail, B: detail }),
    ).toEqual(["A", "B"]);
    expect(comparePlacementContext(["A"], {})).toEqual([]);
  });
});

describe("object and environmental context", () => {
  const answers = { secure: true, moves: true, daily: true, personal: true };
  it("recognizes phones and asks about water and unrelated carrying", () => {
    const phone = { name: "My iPhone", answers };
    expect(placementRisks(phone.name).map((risk) => risk.key)).toEqual([
      "dry",
      "routineMotion",
    ]);
    expect(questionsForPlacement(phone)[0].key).toBe("dry");
    expect(placementResult(phone).rank).toBe(0);
    expect(
      placementResult({ ...phone, answers: { ...answers, dry: false } }).reason,
    ).toContain("rules out");
    expect(
      placementResult({
        ...phone,
        answers: { ...answers, dry: true, routineMotion: true },
      }).rank,
    ).toBe(2);
    expect(riskCost(placementRisks(phone.name))).toBeGreaterThan(
      riskCost(placementRisks("Drawer")),
    );
  });
  it("checks household and per-location context even for unfamiliar object names", () => {
    expect(
      placementRisks("Object A", "Near the sink").map((risk) => risk.key),
    ).toContain("dry");
    expect(
      placementRisks("Object A", "", "Often used outside in the rain").map(
        (risk) => risk.key,
      ),
    ).toEqual(["dry", "indoors"]);
    expect(placementRisks("Kettle").map((risk) => risk.key)).toContain("cool");
    expect(placementRisks("Hotline drawer")).toEqual([]);
  });
  it("treats negated descriptions as a prompt to verify, not proof of exposure", () => {
    const idea = {
      name: "Drawer",
      description: "Never gets wet",
      answers: { ...answers, dry: true },
    };
    expect(placementResult(idea).rank).toBe(2);
  });
  it("cannot promote a wet phone through high routine scores", () => {
    const detail = {
      routine: "Morning use",
      relevance: "2",
      consistency: "2",
      frequency: "2",
    };
    const context = {
      Phone: { ...detail, riskAnswers: { dry: false, routineMotion: true } },
      Drawer: { ...detail, relevance: "1" },
    };
    expect(comparePlacementContext(["Phone", "Drawer"], context)).toEqual([
      "Drawer",
    ]);
    expect(comparePlacementContext(["Phone"], context)).toEqual([]);
  });
  it("uses descriptions added during tie-breaking and rejects all-unconfirmed conditions", () => {
    const detail = {
      routine: "Used near a sink",
      relevance: "2",
      consistency: "2",
      frequency: "1",
    };
    expect(
      comparePlacementContext(["A", "B"], { A: detail, B: detail }),
    ).toEqual([]);
    expect(
      comparePlacementContext(["A", "B"], {
        A: detail,
        B: { ...detail, riskAnswers: { dry: true } },
      }),
    ).toEqual(["B"]);
  });
});
