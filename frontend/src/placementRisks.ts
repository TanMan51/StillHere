export type RiskKey = "dry" | "cool" | "indoors" | "routineMotion";
export type RiskAnswers = Partial<Record<RiskKey, boolean>>;

export interface PlacementRisk {
  key: RiskKey;
  label: string;
  question: string;
  reason: string;
  cost: number;
}

// These are conservative prompts, not claims about a particular device's protection rating.
// Mentioning a condition (including a negated one) asks the user to verify it.
export function placementRisks(
  name: string,
  description = "",
  household = "",
): PlacementRisk[] {
  const object = `${name} ${description}`.toLowerCase();
  const surroundings = `${object} ${household}`.toLowerCase();
  const phone =
    /\b(phone|smartphone|cellphone|iphone|mobile|tablet|ipad)\b/.test(object);
  const risks: PlacementRisk[] = [];
  if (
    phone ||
    /\b(wet|water|splash\w*|spill\w*|sink|shower|bath\w*|dish\w*|wash\w*|laundry|toothbrush|faucet|tap|bottle|mug|cup|rain\w*|swim\w*)\b/.test(
      surroundings,
    )
  ) {
    risks.push({
      key: "dry",
      label: "Water and cleaning",
      cost: 2,
      question: "Will the tracker stay dry during normal use and cleaning?",
      reason: phone
        ? "A phone may be taken near sinks, showers, or spills. Its own water resistance would not protect an attached tracker. Check the actual mounting location."
        : "The description mentions water, washing, or a potentially wet area. Check whether the tracker itself could get splashed or washed.",
    });
  }
  if (
    /\b(stove|oven|hob|burner|kettle|heater|radiator|hot|steam|heat)\b/.test(
      surroundings,
    )
  ) {
    risks.push({
      key: "cool",
      label: "Heat exposure",
      cost: 3,
      question: "Will the tracker stay away from heat and steam during use?",
      reason:
        "The description suggests possible heat or steam exposure. A location used often is still unsuitable if it exposes the tracker to these conditions.",
    });
  }
  if (
    /\b(outdoor\w*|outside|garden|rain\w*|patio|balcony)\b/.test(surroundings)
  ) {
    risks.push({
      key: "indoors",
      label: "Weather exposure",
      cost: 2,
      question: "Will the tracker remain indoors and protected from weather?",
      reason:
        "The description mentions outdoor conditions. Verify the mounting point rather than assuming the tracker is weatherproof.",
    });
  }
  if (
    phone ||
    /\b(keys|keychain|handbag|backpack|purse|wallet)\b/.test(object)
  ) {
    risks.push({
      key: "routineMotion",
      label: "Portable object",
      cost: 1,
      question:
        "Will movement of this object mainly represent the routine you want to monitor?",
      reason:
        "A portable object can move when it is carried or leave the home. That movement may not represent the household routine you want to monitor.",
    });
  }
  return risks;
}

export function riskCost(risks: PlacementRisk[]): number {
  return risks.reduce((total, risk) => total + risk.cost, 0);
}
