import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import PlacementContextForm from "./PlacementContext";
import { placementRisks, riskCost } from "./placementRisks";
import { placementResult, questionsForPlacement, type PlacementIdea } from "./placement";

export function PlacementHelp() {
  const navigate = useNavigate();
  return (
    <section className="placement-invite">
      <div>
        <h2>Tracker placement guide</h2>
        <p>Compare five ideas with a few questions about everyday use.</p>
      </div>
      <button onClick={() => navigate("/placement")}>Help me choose a spot</button>
    </section>
  );
}

export function SetupPrompt() {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  return (
    <section className="placement-invite" aria-labelledby="setup-prompt-title">
      <div>
        <h2 id="setup-prompt-title">Set up your device</h2>
        <p>
          {asking
            ? "Do you already know where this sensor will go?"
            : "Connect a new sensor and choose where it lives."}
        </p>
      </div>
      {asking ? (
        <div className="placement-choices">
          <button className="secondary" onClick={() => navigate("/setup")}>
            Yes, I know the spot
          </button>
          <button onClick={() => navigate("/placement")}>Help me choose a spot</button>
        </div>
      ) : (
        <button onClick={() => setAsking(true)}>Set up your device</button>
      )}
    </section>
  );
}

interface Progress {
  ideas: PlacementIdea[];
  idea: number;
  question: number;
}
export default function PlacementGuide() {
  const [names, setNames] = useState<string[]>(Array(5).fill(""));
  const [descriptions, setDescriptions] = useState<string[]>(Array(5).fill(""));
  const [household, setHousehold] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [history, setHistory] = useState<Progress[]>([]);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{
    name: string;
    reason: string;
    rejected: Record<string, string>;
  } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const finished = progress !== null && progress.idea === progress.ideas.length;
  useEffect(() => {
    heading.current?.focus();
  }, [progress?.idea, progress?.question, finished, selection?.name]);

  function start(event: FormEvent) {
    event.preventDefault();
    const filled = names.map((name) => name.trim()).filter(Boolean);
    if (!filled.length) {
      setError("Enter at least one idea to get started.");
      return;
    }
    if (new Set(filled.map((name) => name.toLowerCase())).size !== filled.length) {
      setError("Give each idea a different name so you can compare them.");
      return;
    }
    setError("");
    setSelection(null);
    setHistory([]);
    setProgress({
      ideas: names
        .map((name, index) => ({
          name: name.trim(),
          description: descriptions[index].trim(),
          answers: {},
        }))
        .filter((idea) => idea.name),
      idea: 0,
      question: 0,
    });
  }

  function answer(value: boolean) {
    if (!progress || finished) return;
    const { idea, question } = progress;
    const questions = questionsForPlacement(progress.ideas[idea], household);
    const ideas = progress.ideas.map((item, index) =>
      index === idea
        ? {
            ...item,
            answers: {
              ...item.answers,
              [questions[question].key]: value,
            },
          }
        : item,
    );
    setHistory((previous) => [...previous, progress]);
    // A "no" exits this branch; the final question completes it either way.
    const nextIdea = !value || question === questions.length - 1;
    setProgress({
      ideas,
      idea: nextIdea ? idea + 1 : idea,
      question: nextIdea ? 0 : question + 1,
    });
  }

  function back() {
    setSelection(null);
    const previous = history.at(-1);
    if (previous) {
      setProgress(previous);
      setHistory(history.slice(0, -1));
    } else setProgress(null);
  }

  const results =
    progress?.ideas
      .map((idea) => ({
        ...idea,
        ...placementResult(idea, household),
        risks: placementRisks(idea.name, idea.description, household),
      }))
      .sort((a, b) => b.rank - a.rank || riskCost(a.risks) - riskCost(b.risks)) ?? [];
  const best = results[0]?.rank ?? 0;
  const tied = results.filter(
    (result) =>
      result.rank === best && best > 0 && riskCost(result.risks) === riskCost(results[0].risks),
  );
  const needsContext = finished && tied.length > 1 && !selection;
  if (selection)
    results.sort((a, b) => Number(b.name === selection.name) - Number(a.name === selection.name));
  const questions =
    progress && !finished ? questionsForPlacement(progress.ideas[progress.idea], household) : [];
  return (
    <div className="placement-guide">
      <Link className="back" to="/dashboard">
        ← Back to overview
      </Link>
      <p className="eyebrow">TRACKER PLACEMENT</p>
      <h1 ref={heading} tabIndex={-1}>
        {!progress
          ? "Where could your tracker go?"
          : needsContext
            ? "Placement context"
            : finished
              ? "Placement results"
              : progress.ideas[progress.idea].name}
      </h1>
      {!progress ? (
        <form className="panel" onSubmit={start}>
          <h2>Start with your five ideas</h2>
          <p>
            Think of objects used during a normal day. Enter up to five possibilities; one is enough
            to start.
          </p>
          <label>
            Household background (optional)
            <textarea
              maxLength={500}
              value={household}
              placeholder="For example, the person takes their phone into the bathroom or washes objects frequently."
              onChange={(event) => setHousehold(event.target.value)}
            />
          </label>
          {names.map((name, index) => (
            <div key={index}>
              <label>
                Idea {index + 1}
                <input
                  maxLength={80}
                  value={name}
                  placeholder={
                    [
                      "e.g. Fridge door",
                      "e.g. A regularly used drawer",
                      "e.g. Front door",
                      "Another everyday object",
                      "One more possibility",
                    ][index]
                  }
                  onChange={(event) => {
                    setNames(names.map((value, i) => (i === index ? event.target.value : value)));
                    setError("");
                  }}
                />
              </label>
              <label>
                Context for idea {index + 1} (optional)
                <input
                  maxLength={240}
                  value={descriptions[index]}
                  placeholder="Where it is kept, how it is used, and how it is cleaned"
                  onChange={(event) =>
                    setDescriptions(
                      descriptions.map((value, i) => (i === index ? event.target.value : value)),
                    )
                  }
                />
              </label>
              {name.trim() && placementRisks(name, descriptions[index], household).length > 0 && (
                <div className="placement-risk">
                  <strong>Potential concerns to check</strong>
                  <ul>
                    {placementRisks(name, descriptions[index], household).map((risk) => (
                      <li key={risk.key}>{risk.reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit">Compare my ideas</button>
          <p className="muted">
            Your answers stay on this page. Leaving or refreshing starts over.
          </p>
        </form>
      ) : !finished ? (
        <section className="panel">
          <p className="eyebrow">
            IDEA {progress.idea + 1} OF {progress.ideas.length} · QUESTION {progress.question + 1}{" "}
            OF {questions.length}
          </p>
          <ol className="placement-path" aria-label="Decision tree path">
            {questions.map((question, index) => (
              <li
                key={question.key}
                aria-current={index === progress.question ? "step" : undefined}
              >
                {index + 1}.{" "}
                {question.key === "secure"
                  ? "Attachment"
                  : question.key === "moves"
                    ? "Movement"
                    : question.key === "daily"
                      ? "Daily use"
                      : question.key === "personal"
                        ? "Personal use"
                        : question.key === "dry"
                          ? "Water"
                          : question.key === "cool"
                            ? "Heat"
                            : question.key === "indoors"
                              ? "Weather"
                              : "Portability"}
              </li>
            ))}
          </ol>
          <h2>{questions[progress.question].title}</h2>
          <p>{questions[progress.question].hint}</p>
          <div className="button-row placement-actions">
            <button onClick={() => answer(true)}>Yes</button>
            <button className="secondary" onClick={() => answer(false)}>
              No / not sure
            </button>
          </div>
          <p className="muted">If a spot does not fit, we’ll move to your next idea.</p>
          <button className="secondary" onClick={back}>
            Back
          </button>
        </section>
      ) : needsContext ? (
        <PlacementContextForm
          names={tied.map((result) => result.name)}
          onChoose={(name, reason, rejected) => setSelection({ name, reason, rejected })}
          onBack={back}
        />
      ) : (
        <section className="panel">
          <h2>
            {best === 2
              ? "Recommended placements"
              : best === 1
                ? "A possible fit, with shared use to consider"
                : "Try a different set of spots"}
          </h2>
          <p>
            {best
              ? (selection?.reason ??
                `Recommended starting location: ${results[0].name}. We compare the completed placement checks first, then prefer fewer potential exposure and portability concerns. ${results[0].reason}`)
              : "None of these ideas passed the placement and environmental checks. Review the reasons below and try a dry, secure location used during the routine you want to monitor."}
          </p>
          <ol className="placement-results">
            {results.map((result) => (
              <li key={result.name}>
                <h3>{result.name}</h3>
                <strong>
                  {selection?.rejected[result.name]
                    ? "Reconsider this spot"
                    : result.rank > 0
                      ? result.name === (selection?.name ?? results[0].name)
                        ? "Recommended placement"
                        : "Alternative placement"
                      : "Reconsider this spot"}
                </strong>
                <p>
                  {selection?.rejected[result.name] ??
                    (selection?.name === result.name ? selection.reason : result.reason)}
                </p>
                {result.risks.length > 0 && (
                  <div className="placement-risk">
                    <strong>Context considered</strong>
                    <ul>
                      {result.risks.map((risk) => (
                        <li key={risk.key}>
                          {risk.reason}{" "}
                          {result.answers[risk.key] === true
                            ? "You confirmed this condition is addressed; it still requires care in use."
                            : result.answers[risk.key] === false
                              ? "You could not confirm this condition, so this location is excluded."
                              : "This condition has not been confirmed."}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {best > 0 && (
            <p>
              Before settling on a spot, try a normal use of the object and check that its movement
              appears on the dashboard.
            </p>
          )}
          <div className="button-row">
            <button
              onClick={() => {
                setProgress(null);
                setHistory([]);
              }}
            >
              Edit my ideas
            </button>
            <button className="secondary" onClick={back}>
              Review last answer
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
