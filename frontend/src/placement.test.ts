import { describe, expect, it } from "vitest";
import { inferPlacement, rankPlacements, verdict, type PlacementIdea } from "./placement";
import { placementRisks, riskCost } from "./placementRisks";

const idea = (name: string, description = "", overrides = {}): PlacementIdea => ({
  name,
  description,
  overrides,
});
const order = (ideas: PlacementIdea[], household: "alone" | "others" | "unknown" = "alone") =>
  rankPlacements(ideas, household).map((result) => result.idea.name);

describe("automatic placement answers", () => {
  it("knows common objects without asking", () => {
    const fridge = inferPlacement("Fridge door", "", "alone");
    expect(fridge.answers).toMatchObject({
      moves: true,
      daily: true,
      secure: true,
      personal: true,
    });
    expect(fridge.why).toContain("meal");
    expect(inferPlacement("Walker", "", "others").answers.personal).toBe(true);
    expect(inferPlacement("Bookshelf", "", "alone").answers.moves).toBe(false);
  });
  it("uses the household for shared objects and leaves it open when unknown", () => {
    expect(inferPlacement("Front door", "", "others").answers.personal).toBe(false);
    expect(inferPlacement("Front door", "", "alone").answers.personal).toBe(true);
    expect(inferPlacement("Front door", "", "unknown").answers.personal).toBeUndefined();
  });
  it("reads unfamiliar names and details instead of asking", () => {
    expect(inferPlacement("Sewing box lid", "", "alone").answers.moves).toBe(true);
    expect(inferPlacement("Hall table", "", "alone").answers.moves).toBe(false);
    expect(inferPlacement("Garden gate", "used every morning", "alone").answers.daily).toBe(true);
    expect(inferPlacement("Guest room door", "", "alone").answers.daily).toBe(false);
    expect(inferPlacement("Thing", "", "alone").answers.moves).toBeUndefined();
  });
});

describe("ranking", () => {
  it("never recommends a spot that doesn't move, can't attach, or isn't used daily", () => {
    const results = rankPlacements(
      [
        idea("Stationary shelf"),
        idea("Loose spot", "", { secure: false }),
        idea("Guest room door"),
      ],
      "alone",
    );
    expect(results.every((result) => result.excluded !== null)).toBe(true);
  });
  it("puts the best everyday spots first and ruled-out ones last", () => {
    expect(order([idea("Bookshelf"), idea("Front door"), idea("Walker")], "others")).toEqual([
      "Walker",
      "Front door",
      "Bookshelf",
    ]);
  });
  it("ranks personal use above shared use without discarding shared spots", () => {
    const [first, second] = rankPlacements([idea("Front door"), idea("Pill box")], "others");
    expect(first.idea.name).toBe("Pill box");
    expect(second.excluded).toBeNull();
  });
  it("lets a tapped correction win over the guess", () => {
    const corrected = rankPlacements([idea("Fridge door", "", { moves: false })], "alone")[0];
    expect(corrected.answers.moves).toBe(false);
    expect(corrected.excluded).toContain("move");
  });
  it("lists only what it couldn't work out as open", () => {
    expect(rankPlacements([idea("Fridge door")], "alone")[0].open).toEqual([]);
    expect(rankPlacements([idea("Thing")], "alone")[0].open).toEqual(
      expect.arrayContaining(["moves", "daily", "secure"]),
    );
  });
  it("ranks wet or portable spots lower until their concerns are confirmed", () => {
    expect(order([idea("My iPhone"), idea("Kitchen drawer")])).toEqual([
      "Kitchen drawer",
      "My iPhone",
    ]);
    const confirmed = rankPlacements(
      [
        idea("My iPhone", "", {
          dry: true,
          routineMotion: true,
          secure: true,
          moves: true,
          daily: true,
        }),
      ],
      "alone",
    )[0];
    expect(confirmed.excluded).toBeNull();
    expect(rankPlacements([idea("My iPhone", "", { dry: false })], "alone")[0].excluded).toContain(
      "Water",
    );
  });
});

describe("verdicts", () => {
  it("calls ties equally good and guesses check first", () => {
    const results = rankPlacements([idea("Fridge door"), idea("Walker"), idea("Thing")], "alone");
    const [best] = results;
    expect(results.map((result) => verdict(result, best))).toEqual([
      "Best choice",
      "Equally good",
      "Check first",
    ]);
  });
  it("rules out wet taps that are hard to attach", () => {
    const [sink] = rankPlacements([idea("Bathroom sink")], "alone");
    expect(verdict(sink, undefined)).toBe("Not a good spot");
  });
});

describe("object and environmental context", () => {
  it("recognizes phones and asks about water and unrelated carrying", () => {
    expect(placementRisks("My iPhone").map((risk) => risk.key)).toEqual(["dry", "routineMotion"]);
    expect(riskCost(placementRisks("My iPhone"))).toBeGreaterThan(
      riskCost(placementRisks("Drawer")),
    );
  });
  it("checks household and per-location context even for unfamiliar object names", () => {
    expect(placementRisks("Object A", "Near the sink").map((risk) => risk.key)).toContain("dry");
    expect(
      placementRisks("Object A", "", "Often used outside in the rain").map((risk) => risk.key),
    ).toEqual(["dry", "indoors"]);
    expect(placementRisks("Kettle").map((risk) => risk.key)).toContain("cool");
    expect(placementRisks("Hotline drawer")).toEqual([]);
  });
});
