import {
  placementRisks,
  riskCost,
  type PlacementRisk,
  type RiskAnswers,
  type RiskKey,
} from "./placementRisks";

// Ranks possible tracker spots without a questionnaire: the four placement checks are worked
// out from the object's name, its optional details, and who lives there. Every answer is shown
// and can be corrected, so a wrong guess costs one tap instead of a list of questions.

export type CheckKey = "secure" | "moves" | "daily" | "personal";
export type AnswerKey = CheckKey | RiskKey;
export type PlacementAnswers = RiskAnswers & Partial<Record<CheckKey, boolean>>;
export type Household = "alone" | "others" | "unknown";

export const CHECKS: Record<CheckKey, { yes: string; no: string; unknown: string }> = {
  moves: {
    yes: "Moves when used",
    no: "Doesn’t move when used",
    unknown: "Moves when used?",
  },
  daily: { yes: "Used every day", no: "Not used every day", unknown: "Used every day?" },
  secure: { yes: "Attaches securely", no: "Hard to attach", unknown: "Attaches securely?" },
  personal: {
    yes: "Mostly used by them",
    no: "Shared with others",
    unknown: "Mostly used by them?",
  },
};

interface KnownObject {
  match: RegExp;
  moves: boolean;
  daily: boolean;
  secure: boolean;
  // "shared": used by everyone at home, so personal use depends on who lives there.
  use: "personal" | "shared";
  why: string;
}

// Everyday objects people suggest most, with what an accelerometer tag on them would see.
const KNOWN: KnownObject[] = [
  {
    match: /\b(walker|rollator|wheelchair|zimmer)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Moves with nearly every trip around the home",
  },
  {
    match: /\b(cane|walking stick|crutch\w*)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Moves whenever they walk with it",
  },
  {
    match: /\b(pill\s*box|pillbox|pill organi[sz]er|medication|medicine|pills?)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Opened at medication times every day",
  },
  {
    match: /\b(fridge|refrigerator|freezer)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Opened at nearly every meal",
  },
  {
    match: /\b(microwave)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Its door opens whenever a meal is warmed up",
  },
  {
    match: /\b(bed|mattress|bed ?frame|nightstand|bedside)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Shows getting up in the morning and going to bed",
  },
  {
    match: /\b(recliner|armchair|favorite chair|favourite chair)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Moves when they sit down or get up",
  },
  {
    match: /\b(bathroom door|toilet|commode)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Used several times every day",
  },
  {
    match: /\b(front door|back door|entry door|main door)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Shows comings and goings",
  },
  {
    match: /\b(bedroom door|closet|wardrobe|dresser)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "personal",
    why: "Opened when getting up and dressing",
  },
  {
    match: /\b(pantry|cupboard|cabinet|drawer)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Opened during daily routines like meals",
  },
  {
    match: /\b(kettle|coffee ?(maker|machine|pot)|toaster)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Part of a morning routine",
  },
  {
    match: /\b(curtains?|blinds?)\b/,
    moves: true,
    daily: true,
    secure: true,
    use: "shared",
    why: "Opened in the morning and closed at night",
  },
  {
    match: /\b(sink|faucet|tap|shower|bathtub|tub)\b/,
    moves: true,
    daily: true,
    secure: false,
    use: "shared",
    why: "The handle turns every day, but it’s wet and hard to attach to",
  },
  {
    match: /\b(remote|tv remote|controller)\b/,
    moves: true,
    daily: true,
    secure: false,
    use: "shared",
    why: "Used daily, but small, shared, and easy to misplace",
  },
  {
    match: /\b(mailbox|mail box|letterbox)\b/,
    moves: true,
    daily: false,
    secure: true,
    use: "shared",
    why: "Checked about once a day at most, and often outside",
  },
  {
    match:
      /(shel(f|ves)|\b(wall|table|counter(top)?|floor|ceiling|window ?sill|mantel|picture frame))\b/,
    moves: false,
    daily: true,
    secure: true,
    use: "shared",
    why: "Stays still, so it won’t register when someone is active",
  },
];

// For names the table doesn't know: what the words suggest.
const MOVING_PART = /\b(door|drawer|lid|handle|hatch|gate|flap|cabinet|cupboard|box|bag|bottle)\b/;
const STATIONARY = /(shel(f|ves)|\b(wall|table|counter|floor|ceiling|sill|frame|mantel|stand))\b/;
const DAILY_WORDS =
  /\b(every ?day|daily|each (morning|day|night|meal)|every (morning|night|meal)|always|routine)\b/;
const RARE_WORDS = /\b(rarely|sometimes|occasionally|weekly|monthly|guest|holiday|seasonal)\b/;

export interface Inference {
  answers: PlacementAnswers;
  // Why each check came out the way it did, when there is a reason worth showing.
  reasons: Partial<Record<CheckKey, string>>;
  why: string | null;
}

export function inferPlacement(name: string, description = "", household: Household): Inference {
  const text = `${name} ${description}`.toLowerCase();
  const known = KNOWN.find((item) => item.match.test(text));
  const answers: PlacementAnswers = {};
  const reasons: Inference["reasons"] = {};
  if (known) {
    answers.moves = known.moves;
    answers.daily = known.daily;
    answers.secure = known.secure;
  } else {
    if (MOVING_PART.test(text)) answers.moves = true;
    else if (STATIONARY.test(text)) answers.moves = false;
    if (answers.moves !== undefined) answers.secure = true;
  }
  // What the details say about how often it's used overrides the general expectation.
  if (RARE_WORDS.test(text)) {
    answers.daily = false;
    reasons.daily = "Your details say it isn’t used every day";
  } else if (DAILY_WORDS.test(text)) {
    answers.daily = true;
    reasons.daily = "Your details say it’s part of the daily routine";
  }
  if (known?.use === "personal") answers.personal = true;
  else if (household === "alone") {
    answers.personal = true;
    reasons.personal = "They live alone";
  } else if (household === "others") {
    answers.personal = false;
    reasons.personal = "Others at home use it too";
  }
  return { answers, reasons, why: known?.why ?? null };
}

export interface PlacementIdea {
  name: string;
  description: string;
  // Corrections the user made by tapping a chip; they win over the inferred answers.
  overrides: PlacementAnswers;
}

export interface RankedPlacement {
  idea: PlacementIdea;
  answers: PlacementAnswers;
  inference: Inference;
  risks: PlacementRisk[];
  // Checks and risks with no answer yet: the only things worth asking about.
  open: AnswerKey[];
  excluded: string | null;
  score: number;
}

const RULES_OUT: Record<CheckKey, string | null> = {
  secure: "It needs a spot where the tracker stays firmly attached.",
  moves: "The spot needs to move when the object is used, or activity will be missed.",
  daily: "Something used every day shows a routine; occasional use doesn’t.",
  personal: null,
};

function exclusion(answers: PlacementAnswers, risks: PlacementRisk[]): string | null {
  for (const key of ["secure", "moves", "daily"] as const)
    if (answers[key] === false) return RULES_OUT[key];
  const failed = risks.find((risk) => answers[risk.key] === false);
  return failed ? `${failed.label}: ${failed.reason}` : null;
}

// Movement matters most, then daily use, then a secure fit, then personal use. Unanswered
// checks count half, and unconfirmed safety concerns cost their weight.
const WEIGHTS: Record<CheckKey, number> = { moves: 8, daily: 6, secure: 4, personal: 3 };

export function scorePlacement(answers: PlacementAnswers, risks: PlacementRisk[]): number {
  const checks = (Object.keys(WEIGHTS) as CheckKey[]).reduce(
    (total, key) =>
      total +
      (answers[key] === true ? WEIGHTS[key] : answers[key] === undefined ? WEIGHTS[key] / 2 : 0),
    0,
  );
  const unconfirmed = risks.filter((risk) => answers[risk.key] !== true);
  return checks - riskCost(unconfirmed) * 2;
}

const CORE: AnswerKey[] = ["moves", "daily", "secure"];

/** The label for one ranked idea. A guess isn't a recommendation, so an idea with unanswered
 * core checks says "Check first" until they're tapped. */
export function verdict(result: RankedPlacement, best: RankedPlacement | undefined): string {
  if (result.excluded) return "Not a good spot";
  if (result.open.some((key) => CORE.includes(key))) return "Check first";
  if (result === best) return "Best choice";
  return best && result.score === best.score ? "Equally good" : "Also works";
}

export function rankPlacements(
  ideas: PlacementIdea[],
  household: Household,
  notes = "",
): RankedPlacement[] {
  return ideas
    .map((idea) => {
      const inference = inferPlacement(idea.name, idea.description, household);
      const answers = { ...inference.answers, ...idea.overrides };
      const risks = placementRisks(idea.name, idea.description, notes);
      const open = [
        ...(Object.keys(CHECKS) as CheckKey[]).filter((key) => answers[key] === undefined),
        ...risks.filter((risk) => answers[risk.key] === undefined).map((risk) => risk.key),
      ];
      return {
        idea,
        answers,
        inference,
        risks,
        open,
        excluded: exclusion(answers, risks),
        score: scorePlacement(answers, risks),
      };
    })
    .sort(
      (a, b) =>
        Number(a.excluded !== null) - Number(b.excluded !== null) ||
        b.score - a.score ||
        riskCost(a.risks) - riskCost(b.risks),
    );
}
