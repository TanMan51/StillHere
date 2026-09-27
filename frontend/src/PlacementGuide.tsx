import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CHECKS,
  rankPlacements,
  verdict,
  type AnswerKey,
  type CheckKey,
  type Household,
  type PlacementAnswers,
  type RankedPlacement,
} from "./placement";
import { api } from "./api";
import { usePoll } from "./hooks";
import type { Device } from "./types";
import PlacementPodium from "./PlacementPodium";

export function SetupPrompt() {
  const navigate = useNavigate();
  return (
    <section className="placement-invite" aria-labelledby="setup-prompt-title">
      <div>
        <h2 id="setup-prompt-title">Set up your device</h2>
        <p>Connect a new sensor and choose where it lives.</p>
      </div>
      <button onClick={() => navigate("/setup-device")}>Set up your device</button>
    </section>
  );
}

// Asks first so people who already know the spot skip the placement questions.
function capitalize(text: string) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * Links a physical sensor to the chosen spot by naming it, then opens its page. "Shake to
 * identify": the first sensor to report movement after the page opens is picked automatically,
 * so nobody has to know which name belongs to the sensor in their hand.
 */
function NameSensor({ spot }: { spot: string }) {
  const navigate = useNavigate();
  const { data, error } = usePoll(api.devices);
  // Each sensor's last movement as of the previous check. A sensor is identified when that
  // value changes, so stale timestamps (even ones a fast demo clock left in the future) can't
  // be mistaken for someone moving it now.
  const previous = useRef<Map<string, string | null> | null>(null);
  const [found, setFound] = useState<Device | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(capitalize(spot));
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!data) return;
    const before = previous.current;
    previous.current = new Map(data.devices.map((device) => [device.id, device.last_motion_at]));
    if (!before || picked) return;
    const moved = data.devices.find(
      (device) => before.has(device.id) && device.last_motion_at !== before.get(device.id),
    );
    if (moved) setFound(moved);
  }, [data, picked]);
  const devices = data?.devices ?? [];
  const deviceId = picked ?? found?.id ?? devices[0]?.id ?? "";

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setMessage("Give the sensor a name.");
      return;
    }
    try {
      await api.updateDevice(deviceId, { name: name.trim() });
      navigate(`/devices/${encodeURIComponent(deviceId)}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    }
  }
  if (data && !devices.length)
    return <p className="muted">No sensors are connected to this account yet.</p>;
  return (
    <form className="name-sensor" onSubmit={save}>
      <h3>Which sensor is this?</h3>
      {picked ? null : found ? (
        <p className="shake-status shake-found" role="status">
          <span aria-hidden="true">✓</span>
          <span>
            Found it: <strong>{found.name}</strong> just moved.
          </span>
        </p>
      ) : (
        <p className="shake-status" role="status">
          <span className="shake-dot" aria-hidden="true" />
          Move the sensor you’re attaching now. We’ll recognize it as soon as it reports movement.
        </p>
      )}
      <label>
        Sensor {found || picked ? "" : "(or pick it yourself)"}
        <select value={deviceId} onChange={(e) => setPicked(e.target.value)}>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name it after its spot
        <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {(message || error) && <small role="status">{message || error}</small>}
      <button type="submit" disabled={!deviceId}>
        Save and watch for the first movement
      </button>
    </form>
  );
}

// Asks first so people who already know the spot skip the placement guide. Arriving from the
// guide, the chosen spot is already known, so it goes straight to attaching and naming it.
export function DeviceSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const chosen: unknown = location.state?.spot;
  const spot = typeof chosen === "string" && chosen.trim() ? chosen.trim() : "";
  const [knowsSpot, setKnowsSpot] = useState(spot !== "");
  const object = spot ? `the ${spot.toLowerCase()}` : "the object";
  return (
    <div className="placement-guide">
      <Link className="back" to={spot ? "/placement" : "/dashboard"}>
        {spot ? "← Back to the ranking" : "← Back to overview"}
      </Link>
      <p className="eyebrow">DEVICE SETUP</p>
      <h1>{spot ? `Set up the tracker on ${object}` : "Set up your device"}</h1>
      {knowsSpot ? (
        <section className="panel">
          <h2>Attach the sensor</h2>
          <ol className="setup-steps">
            <li>Attach the sensor firmly to {object}, on the part that moves when it’s used.</li>
            <li>Plug in or power on the sensor and keep it within range of your Wi-Fi.</li>
            <li>Use {object} once. The sensor’s page updates within a few seconds.</li>
          </ol>
          <NameSensor spot={spot} />
          <div className="placement-choices">
            <button
              className="secondary"
              onClick={() => (spot ? navigate("/placement") : setKnowsSpot(false))}
            >
              Back
            </button>
            <button className="secondary" onClick={() => navigate("/dashboard")}>
              Go to my devices
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>Do you already know where this sensor will go?</h2>
          <p>Not sure? Type a few ideas and we’ll rank them for you.</p>
          <div className="placement-choices">
            <button className="secondary" onClick={() => setKnowsSpot(true)}>
              Yes, I know the spot
            </button>
            <button onClick={() => navigate("/placement")}>No, help me choose</button>
          </div>
        </section>
      )}
    </div>
  );
}

const PLACEHOLDERS = [
  "e.g. Fridge door",
  "e.g. Walker",
  "e.g. Front door",
  "Another everyday object",
  "One more idea",
];
const HOUSEHOLDS: { value: Household; label: string }[] = [
  { value: "alone", label: "Lives alone" },
  { value: "others", label: "Lives with others" },
  { value: "unknown", label: "Not sure" },
];
const RISK_CHIPS: Record<string, string> = {
  dry: "Stays dry",
  cool: "Away from heat",
  indoors: "Stays indoors",
  routineMotion: "Its movement means activity at home",
};
const CHECK_ORDER: CheckKey[] = ["moves", "daily", "secure", "personal"];

interface Chip {
  key: AnswerKey;
  label: string;
  value: boolean | undefined;
  risk: boolean;
}

function chipsFor(result: RankedPlacement): Chip[] {
  const checks = CHECK_ORDER.map((key) => {
    const value = result.answers[key];
    const words = CHECKS[key];
    return {
      key,
      value,
      risk: false,
      label: value === true ? words.yes : value === false ? words.no : words.unknown,
    };
  });
  const risks = result.risks.map((risk) => ({
    key: risk.key,
    value: result.answers[risk.key],
    risk: true,
    label: RISK_CHIPS[risk.key] ?? risk.label,
  }));
  return [...checks, ...risks];
}

/** One answer. Tapping flips it; a guess or an open question becomes a confirmed "yes". */
function AnswerChip({ chip, onToggle }: { chip: Chip; onToggle: () => void }) {
  const mark = chip.value === true ? "✓" : chip.value === false ? "✗" : chip.risk ? "⚠" : "?";
  const state = chip.value === true ? "yes" : chip.value === false ? "no" : "open";
  const label = chip.risk && chip.value === undefined ? `${chip.label}?` : chip.label;
  return (
    <button
      type="button"
      className={`answer-chip answer-${state}${chip.risk ? " answer-risk" : ""}`}
      aria-pressed={chip.value === true}
      title="Tap to correct"
      onClick={onToggle}
    >
      <span aria-hidden="true">{mark}</span> {label}
    </button>
  );
}

// The guide's inputs, kept for this browser tab so "Back to the ranking" returns to it.
interface SavedGuide {
  names: string[];
  details: string[];
  household: Household;
  notes: string;
  overrides: Record<string, PlacementAnswers>;
  ranked: boolean;
}
const GUIDE_KEY = "stillhere-placement";
function loadGuide(): SavedGuide | null {
  try {
    const saved = sessionStorage.getItem(GUIDE_KEY);
    return saved ? (JSON.parse(saved) as SavedGuide) : null;
  } catch {
    return null;
  }
}
function saveGuide(guide: SavedGuide) {
  try {
    sessionStorage.setItem(GUIDE_KEY, JSON.stringify(guide));
  } catch {
    /* Without storage the guide still works; it just starts over after leaving. */
  }
}

// Type a few ideas and get a ranking right away; answers are worked out, not asked.
export default function PlacementGuide() {
  const navigate = useNavigate();
  const saved = loadGuide();
  const [names, setNames] = useState<string[]>(saved?.names ?? Array(5).fill(""));
  const [details, setDetails] = useState<string[]>(saved?.details ?? Array(5).fill(""));
  const [household, setHousehold] = useState<Household>(saved?.household ?? "unknown");
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [overrides, setOverrides] = useState<Record<string, PlacementAnswers>>(
    saved?.overrides ?? {},
  );
  const [ranked, setRanked] = useState(saved?.ranked ?? false);
  useEffect(() => {
    saveGuide({ names, details, household, notes, overrides, ranked });
  }, [names, details, household, notes, overrides, ranked]);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [ranked]);

  const ideas = names
    .map((name, index) => ({
      name: name.trim(),
      description: details[index].trim(),
      overrides: overrides[name.trim().toLowerCase()] ?? {},
    }))
    .filter((idea) => idea.name);
  const results = ranked ? rankPlacements(ideas, household, notes) : [];
  const best = results.find((result) => result.excluded === null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ideas.length) {
      setError("Enter at least one idea. Three to five gives the best comparison.");
      return;
    }
    if (new Set(ideas.map((idea) => idea.name.toLowerCase())).size !== ideas.length) {
      setError("Give each idea a different name so you can compare them.");
      return;
    }
    setError("");
    setRanked(true);
  }

  function toggle(name: string, key: AnswerKey, value: boolean | undefined) {
    const id = name.toLowerCase();
    setOverrides((current) => ({
      ...current,
      [id]: { ...current[id], [key]: value !== true },
    }));
  }

  return (
    <div className="placement-guide">
      <Link className="back" to="/dashboard">
        ← Back to overview
      </Link>
      <p className="eyebrow">TRACKER PLACEMENT</p>
      <h1 ref={heading} tabIndex={-1}>
        {ranked ? "Where the tracker should go" : "Where could your tracker go?"}
      </h1>
      {!ranked ? (
        <form className="panel" onSubmit={submit}>
          <h2>Type three to five ideas</h2>
          <p>
            Everyday objects the person uses. We’ll rank them right away, with no questions to
            answer.
          </p>
          <fieldset className="role-choice">
            <legend>Who lives there?</legend>
            {HOUSEHOLDS.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="household"
                  value={option.value}
                  checked={household === option.value}
                  onChange={() => setHousehold(option.value)}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
          <div className="idea-fields">
            {names.map((name, index) => (
              <div className="idea-field" key={index}>
                <label>
                  Idea {index + 1}
                  <input
                    maxLength={80}
                    value={name}
                    placeholder={PLACEHOLDERS[index]}
                    onChange={(event) => {
                      setNames(names.map((value, i) => (i === index ? event.target.value : value)));
                      setError("");
                    }}
                  />
                </label>
                <label className="idea-details">
                  Details (optional)
                  <input
                    maxLength={240}
                    value={details[index]}
                    placeholder="e.g. next to the sink, used every morning"
                    onChange={(event) =>
                      setDetails(
                        details.map((value, i) => (i === index ? event.target.value : value)),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <label>
            Anything else about the home (optional)
            <textarea
              maxLength={500}
              value={notes}
              placeholder="For example, they take their phone into the bathroom, or the kitchen gets steamy."
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit">Rank my ideas</button>
          <p className="muted">Your ideas stay in this browser tab only.</p>
        </form>
      ) : (
        <section className="panel">
          <h2>{best ? `Best spot: ${best.idea.name}` : "None of these spots fit well"}</h2>
          <p>
            {best
              ? `${best.inference.why ?? "It passes the placement checks"}. We worked out each answer below from what you typed. Tap any that’s wrong and the ranking updates.`
              : "Each idea is ruled out below. Try a spot that moves every time it’s used during the day, such as a fridge door or a walker."}
          </p>
          {results.length > 0 && <PlacementPodium results={results} best={best} />}
          <ol className="placement-results">
            {results.map((result) => (
              <li key={result.idea.name} className={result.excluded ? "placement-excluded" : ""}>
                <div className="placement-result-head">
                  <h3>{result.idea.name}</h3>
                  <strong>{verdict(result, best)}</strong>
                </div>
                <p>
                  {result.excluded ??
                    result.inference.why ??
                    "We don’t know this object well; confirm the ? answers below."}
                </p>
                <div className="answer-chips" aria-label={`Answers for ${result.idea.name}`}>
                  {chipsFor(result).map((chip) => (
                    <AnswerChip
                      key={chip.key}
                      chip={chip}
                      onToggle={() => toggle(result.idea.name, chip.key, chip.value)}
                    />
                  ))}
                </div>
                {result.open.length > 0 && !result.excluded && (
                  <small className="muted">
                    Tap the {result.open.length === 1 ? "open answer" : "open answers"} to confirm.
                  </small>
                )}
              </li>
            ))}
          </ol>
          {best && (
            <p className="muted">
              After attaching it, use the object once and check that the movement shows up on the
              dashboard.
            </p>
          )}
          <div className="button-row">
            {best && (
              <button
                onClick={() => navigate("/setup-device", { state: { spot: best.idea.name } })}
              >
                Set up the tracker on the {best.idea.name.toLowerCase()}
              </button>
            )}
            <button className="secondary" onClick={() => setRanked(false)}>
              Edit my ideas
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
