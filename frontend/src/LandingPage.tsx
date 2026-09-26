import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import IceScene from "./IceScene";
import Login from "./Login";
import { useMock } from "./api";

export default function LandingPage({
  onLogin,
  loggedIn,
}: {
  onLogin: () => void;
  loggedIn: boolean;
}) {
  const location = useLocation();
  const [loginOpen, setLoginOpen] = useState(
    typeof location.state?.from === "string",
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!loginOpen || !element) return;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [loginOpen]);

  return (
    <div className="landing-shell">
      <IceScene />
      <header className="landing-header">
        <Link className="brand" to="/" aria-label="StillHere home">
          <img src="/icon.svg" alt="" />
          StillHere
        </Link>
        <nav aria-label="Site navigation">
          <a href="#about">About us</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <button className="landing-login" onClick={() => setLoginOpen(true)}>
          Log in <span aria-hidden="true">↗</span>
        </button>
      </header>
      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-heading">
            <p className="eyebrow">01 / HOUSEHOLD MONITORING</p>
            <h1 id="landing-title">StillHere</h1>
            <p>
              Device activity.
              <br />
              Routine monitoring.
              <br />
              Family notifications.
            </p>
          </div>
          <div className="landing-scene-label" aria-hidden="true">
            <span>+ HOME / 01</span>
            <span>ACTIVITY SENSOR</span>
          </div>
          <a className="landing-scroll" href="#about">
            About StillHere <span aria-hidden="true">↓</span>
          </a>
          <span className="landing-version">
            {useMock
              ? "PROTOTYPE / DEMO AVAILABLE"
              : "HOUSEHOLD ACTIVITY MONITORING"}
          </span>
        </section>
        <section
          className="landing-section"
          id="about"
          aria-labelledby="about-title"
        >
          <p className="eyebrow">02 / ABOUT US</p>
          <div className="landing-section-body">
            <h2 id="about-title">About StillHere</h2>
            <p className="landing-lead">
              We’re building a way for families to notice changes in everyday
              activity at home.
            </p>
            <p>
              StillHere connects motion sensors on regularly used objects to a
              household dashboard. It is designed to help families recognize
              when a routine changes and decide when to check in.
            </p>
            <p>
              The prototype combines device activity, learned routines, and
              notifications. An activity signal can prompt a conversation; it
              does not confirm someone’s wellbeing.
            </p>
          </div>
        </section>
        <section
          className="landing-section"
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <p className="eyebrow">03 / HOW IT WORKS</p>
          <div className="landing-section-body">
            <h2 id="how-title">From activity to a check-in</h2>
            <div className="landing-steps">
              <article>
                <span>01</span>
                <h3>Place a tracker</h3>
                <p>
                  Choose a dry, secure location on an object used during a
                  regular household routine.
                </p>
              </article>
              <article>
                <span>02</span>
                <h3>Observe the routine</h3>
                <p>
                  Movement events build an activity history. The dashboard shows
                  recent activity and connection status.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>Review changes</h3>
                <p>
                  Inactivity limits and learned patterns help identify changes
                  that may need a family check-in.
                </p>
              </article>
            </div>
          </div>
        </section>
        <section
          className="landing-section"
          id="tracker-setup"
          aria-labelledby="setup-title"
        >
          <p className="eyebrow">04 / TRACKER SETUP</p>
          <div className="landing-section-body">
            <h2 id="setup-title">Choose a suitable location</h2>
            <p>
              The placement guide compares up to five ideas using the person’s
              habits and the environment. Water, heat, outdoor exposure, and
              unrelated movement are considered before a location is
              recommended.
            </p>
            <p>
              In the dashboard, open Setup to compare locations, manage
              contacts, and view activity history.
            </p>
            {loggedIn ? (
              <Link className="landing-text-link" to="/placement">
                Open placement guide ↗
              </Link>
            ) : (
              <button
                className="landing-login"
                onClick={() => setLoginOpen(true)}
              >
                Log in to use the guide ↗
              </button>
            )}
          </div>
        </section>
        <section
          className="landing-section landing-faq"
          aria-labelledby="faq-title"
        >
          <p className="eyebrow">05 / QUESTIONS</p>
          <div className="landing-section-body">
            <h2 id="faq-title">Project information</h2>
            <details>
              <summary>What can I try now?</summary>
              <p>
                The demo dashboard includes sample devices, activity charts,
                contact management, and the tracker placement guide. Demo
                actions do not send texts.
              </p>
            </details>
            <details>
              <summary>Does this replace checking in with someone?</summary>
              <p>
                No. Changes in activity are a reason to check in. Normal
                activity is not proof that someone is okay.
              </p>
            </details>
            <details>
              <summary>Is account login available?</summary>
              <p>
                The current login is for the demo. Real account authentication
                and access controls require backend integration.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>STILLHERE</span>
        <a href="#about">About us</a>
        <a href="#how-it-works">How it works</a>
      </footer>
      <dialog
        ref={dialog}
        className="login-dialog"
        aria-labelledby="login-title"
        onCancel={(event) => {
          event.preventDefault();
          setLoginOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setLoginOpen(false);
        }}
      >
        <div className="login-dialog-content">
          <button
            className="dialog-close secondary"
            aria-label="Close login"
            onClick={() => setLoginOpen(false)}
          >
            Close ×
          </button>
          {loginOpen && <Login onLogin={onLogin} />}
        </div>
      </dialog>
    </div>
  );
}
