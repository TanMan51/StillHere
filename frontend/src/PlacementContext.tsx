import { useState, type FormEvent } from "react";
import { comparePlacementContext, type PlacementContext } from "./placement";
import { placementRisks, type RiskKey } from "./placementRisks";

export default function PlacementContextForm({
  names,
  onChoose,
  onBack,
}: {
  names: string[];
  onChoose: (
    name: string,
    reason: string,
    rejected: Record<string, string>,
  ) => void;
  onBack: () => void;
}) {
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState<Record<string, PlacementContext>>({});
  const [finalists, setFinalists] = useState<string[]>([]);
  const [choice, setChoice] = useState("");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  function clearChoice() {
    setFinalists([]);
    setChoice("");
    setExplanation("");
    setError("");
  }
  function update(
    name: string,
    field: Exclude<keyof PlacementContext, "riskAnswers">,
    value: string,
  ) {
    setContext((current) => ({
      ...current,
      [name]: {
        ...current[name],
        [field]: value,
        ...(field === "routine" ? { riskAnswers: {} } : {}),
      },
    }));
    clearChoice();
  }
  function confirmRisk(name: string, key: RiskKey, value: string) {
    setContext((current) => ({
      ...current,
      [name]: {
        ...current[name],
        riskAnswers: {
          ...current[name]?.riskAnswers,
          [key]: value === "" ? undefined : value === "yes",
        },
      },
    }));
    clearChoice();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const best = comparePlacementContext(names, context);
    if (!best.length) {
      setError(
        "No location meets the environmental checks. Revise the locations or review your previous answers.",
      );
      return;
    }
    if (best.length !== 1 && !choice) {
      setFinalists(best);
      return;
    }
    const winner = best.length === 1 ? best[0] : choice;
    const details = context[winner];
    const rejected = Object.fromEntries(
      names.flatMap((name) => {
        const unresolved = placementRisks(name, context[name]?.routine).filter(
          (risk) => context[name]?.riskAnswers?.[risk.key] !== true,
        );
        return unresolved.length
          ? [
              [
                name,
                `Not recommended: ${unresolved.map((risk) => risk.label.toLowerCase()).join(", ")} conditions were not confirmed. ${unresolved.map((risk) => risk.reason).join(" ")}`,
              ],
            ]
          : [];
      }),
    );
    onChoose(
      winner,
      best.length === 1
        ? `For “${goal.trim()}”, ${winner} ranks first after checking environmental concerns, then relevance, consistency, and frequency. Its routine is: ${details.routine.trim()}.`
        : `For “${goal.trim()}”, you identified ${winner} as the more reliable signal: ${explanation.trim()}. Its routine is: ${details.routine.trim()}.`,
      rejected,
    );
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>Compare the routine behind each location</h2>
      <p>
        These locations passed the same checks. Add context about the person’s
        actual habits to choose between them.
      </p>
      <label>
        What routine do you want to monitor?
        <input
          required
          maxLength={160}
          placeholder="For example, preparing breakfast each morning"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      {names.map((name) => (
        <fieldset className="placement-context" key={name}>
          <legend>{name}</legend>
          <label>
            How and when is {name} used?
            <input
              required
              maxLength={240}
              value={context[name]?.routine ?? ""}
              onChange={(e) => update(name, "routine", e.target.value)}
            />
          </label>
          {placementRisks(name, context[name]?.routine).map((risk) => (
            <div className="placement-risk" key={risk.key}>
              <p>{risk.reason}</p>
              <label>
                {risk.question}
                <select
                  required
                  value={
                    context[name]?.riskAnswers?.[risk.key] === undefined
                      ? ""
                      : context[name].riskAnswers?.[risk.key]
                        ? "yes"
                        : "no"
                  }
                  onChange={(e) => confirmRisk(name, risk.key, e.target.value)}
                >
                  <option value="">Confirm this condition</option>
                  <option value="yes">Yes, this condition is addressed</option>
                  <option value="no">No / not sure</option>
                </select>
              </label>
            </div>
          ))}
          <label>
            How closely does {name} match the routine you want to monitor?
            <select
              required
              value={context[name]?.relevance ?? ""}
              onChange={(e) => update(name, "relevance", e.target.value)}
            >
              <option value="">Select an answer</option>
              <option value="2">Direct part of that routine</option>
              <option value="1">Indirectly related</option>
              <option value="0">Unrelated or unsure</option>
            </select>
          </label>
          <label>
            How consistent is use of {name}?
            <select
              required
              value={context[name]?.consistency ?? ""}
              onChange={(e) => update(name, "consistency", e.target.value)}
            >
              <option value="">Select an answer</option>
              <option value="2">Rarely skipped; similar time each day</option>
              <option value="1">Usually used, but timing varies</option>
              <option value="0">Often skipped or unsure</option>
            </select>
          </label>
          <label>
            How often is {name} used?
            <select
              required
              value={context[name]?.frequency ?? ""}
              onChange={(e) => update(name, "frequency", e.target.value)}
            >
              <option value="">Select an answer</option>
              <option value="2">Several times a day</option>
              <option value="1">Once a day</option>
              <option value="0">Less often or unsure</option>
            </select>
          </label>
        </fieldset>
      ))}
      <p className="muted">
        We check potential exposure and portability concerns before comparing
        relevance, consistency, and frequency. Descriptions trigger specific
        checks; confirm whether each concern applies to the actual location.
      </p>
      {finalists.length > 1 && (
        <fieldset className="placement-context">
          <legend>One more detail is needed</legend>
          <p>
            Your answers still describe equally suitable locations. Which is
            least likely to be skipped in this person’s normal day?
          </p>
          <label>
            Most reliable location
            <select
              required
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Choose a location</option>
              {finalists.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <label>
            What makes it more reliable for this person?
            <input
              required
              maxLength={240}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </label>
        </fieldset>
      )}
      <div className="button-row">
        <button
          type="submit"
          disabled={
            !goal.trim() ||
            names.some((name) => !context[name]?.routine?.trim()) ||
            (finalists.length > 1 && (!choice || !explanation.trim()))
          }
        >
          Choose placement
        </button>
        <button className="secondary" type="button" onClick={onBack}>
          Review previous answers
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
