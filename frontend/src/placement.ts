import { placementRisks, riskCost, type RiskAnswers } from "./placementRisks";

export const placementQuestions = [
  {
    key: "secure",
    title: "Can the tracker stay securely attached here?",
    hint: "Check that it stays dry and does not obstruct the object, its controls, or someone’s movement.",
  },
  {
    key: "moves",
    title: "Does this object move when it is used?",
    hint: "Think about the exact part you would attach it to. A moving door and a stationary shelf give different signals.",
  },
  {
    key: "daily",
    title: "Is it used as part of a daily routine?",
    hint: "Choose something the person already uses regularly, without asking them to change their habits.",
  },
  {
    key: "personal",
    title: "Is it mainly used by the person you want to check on?",
    hint: "Other people or pets using the same object can make its activity harder to interpret.",
  },
] as const;

export type PlacementAnswers = RiskAnswers &
  Partial<Record<(typeof placementQuestions)[number]["key"], boolean>>;
export interface PlacementIdea {
  name: string;
  description?: string;
  answers: PlacementAnswers;
}

export function questionsForPlacement(idea: PlacementIdea, household = "") {
  return [
    ...placementRisks(idea.name, idea.description, household).map((risk) => ({
      key: risk.key,
      title: risk.question,
      hint: risk.reason,
    })),
    ...placementQuestions,
  ];
}

export interface PlacementContext {
  routine: string;
  relevance: string;
  consistency: string;
  frequency: string;
  riskAnswers?: RiskAnswers;
}

// Lexicographic weights keep frequent unrelated activity from outranking a relevant routine.
export function comparePlacementContext(
  names: string[],
  context: Record<string, PlacementContext>,
): string[] {
  const scores = names.map((name) => {
    const details = context[name];
    const risks = placementRisks(name, details?.routine);
    if (
      !details?.routine?.trim() ||
      risks.some((risk) => details.riskAnswers?.[risk.key] !== true) ||
      [details.relevance, details.consistency, details.frequency].some(
        (value) => !["0", "1", "2"].includes(value),
      )
    )
      return { name, score: -1000 };
    return {
      name,
      score:
        Number(details.relevance) * 9 +
        Number(details.consistency) * 3 +
        Number(details.frequency) -
        riskCost(risks) * 27,
    };
  });
  const maximum = Math.max(...scores.map((item) => item.score));
  return scores.every((item) => item.score === -1000)
    ? []
    : scores.filter((item) => item.score === maximum).map((item) => item.name);
}

// A branch stops at the first unsuitable answer; personal use breaks ties among usable ideas.
export function placementResult(idea: PlacementIdea, household = "") {
  const { answers } = idea;
  const risks = placementRisks(idea.name, idea.description, household);
  const unconfirmed = risks.find((risk) => answers[risk.key] !== true);
  if (unconfirmed)
    return {
      rank: 0,
      reason: `${unconfirmed.label}: ${answers[unconfirmed.key] === false ? "Your answer rules out this placement." : "Confirm this condition before choosing this placement."} ${unconfirmed.reason}`,
    };
  if (answers.secure === false)
    return {
      rank: 0,
      reason:
        "Reconsider the attachment: it needs to stay secure, dry, and out of the way.",
    };
  if (answers.moves === false)
    return {
      rank: 0,
      reason:
        "This spot may not move when the object is used, so activity could be missed.",
    };
  if (answers.daily === false)
    return {
      rank: 0,
      reason:
        "Occasional use makes it harder to recognize an everyday routine.",
    };
  if (
    answers.secure &&
    answers.moves &&
    answers.daily &&
    answers.personal !== undefined
  ) {
    return answers.personal
      ? {
          rank: 2,
          reason:
            "Your answers describe a secure spot that moves during a daily routine and is mainly used by one person.",
        }
      : {
          rank: 1,
          reason:
            "This fits a daily routine, but shared use could be mistaken for this person’s activity.",
        };
  }
  return {
    rank: 0,
    reason: "Finish the questions for this idea before comparing it.",
  };
}
