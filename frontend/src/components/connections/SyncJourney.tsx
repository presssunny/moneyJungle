import { useEffect, useRef, useState } from "react";
import type { ConnectionProviderInfo, ConnectionSync } from "../../types/models";
import { isWaiting, journey, milestones, siteDomain, toName, type StepState } from "./syncPhases";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

// Announced sparingly: a screen reader reading every second would drown the rest of the page.
const ANNOUNCE_AT_SECONDS = [60, 30];

function Countdown({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef(new Set<number>());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = new Date(deadlineAt).getTime() - now;
  useEffect(() => {
    const seconds = Math.ceil(left / 1000);
    // The smallest mark already passed — opened at 0:25, it says 30, not 60 — and every larger one is spent.
    const passed = ANNOUNCE_AT_SECONDS.filter((s) => seconds <= s);
    const mark = passed.length ? Math.min(...passed) : undefined;
    if (mark !== undefined && seconds > 0 && !announced.current.has(mark)) {
      for (const s of passed) announced.current.add(s);
      setAnnouncement(`נשארו ${mark} שניות להמתנה`);
    }
  }, [left]);
  return (
    <p className="sync-countdown">
      <span aria-hidden="true">זמן ההמתנה שנותר: <span dir="ltr" className="sync-countdown-value">{clock(left)}</span></span>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </p>
  );
}

const MARK: Record<StepState, string> = { done: "✓", current: "", failed: "✕", todo: "" };

/** What she should do now in the bank's window — and how to tell that the window really is the bank's. */
function WindowGuide({ provider, sync }: { provider: ConnectionProviderInfo | undefined; sync: ConnectionSync }) {
  const domain = siteDomain(provider?.officialLoginUrl ?? null);
  return (
    <div className="sync-journey-guide">
      <p><strong>ההתחברות נעשית בחלון של הבנק, לא כאן.</strong></p>
      <ol className="sync-journey-guide-list">
        <li>עברי לחלון כרום שנפתח (הוא בשורת המשימות, אם הוא מאחור).</li>
        {domain
          ? <li>ודאי שהכתובת בשורת הכתובת שלו מסתיימת ב־<bdi dir="ltr" className="sync-journey-host">{domain}</bdi>. אם לא — אל תיכנסי וסגרי את החלון.</li>
          : <li>אין לנו כתובת רשמית להשוות אליה — בדקי בעצמך שזה האתר של הבנק לפני שנכנסים.</li>}
        <li>היכנסי לחשבון באחת הדרכים שהבנק מציע. כשתיכנסי, זה יופיע כאן מיד.</li>
      </ol>
      {sync.deadlineAt && <Countdown deadlineAt={sync.deadlineAt} />}
    </div>
  );
}

/**
 * The connection as she lives it, step by step. Every tick and every success here comes from the
 * server's own state (milestones) — a sign-in is "successful" only once the library confirmed it.
 */
export function SyncJourney({ sync, provider, bankName }: { sync: ConnectionSync; provider: ConnectionProviderInfo | undefined; bankName: string }) {
  const steps = journey(sync, bankName);
  const m = milestones(sync);
  return (
    <div className="journey">
      {m.signedIn && !m.synced && sync.status === "running" && (
        <div className="sync-journey-success">
          <span className="sync-journey-success-mark" aria-hidden="true">✓</span>
          <div><strong>התחברת בהצלחה {toName(bankName)}</strong><p>אפשר לחזור לכאן — הקריאה ממשיכה לבד.</p></div>
        </div>
      )}
      <ol className="sync-journey-steps">
        {steps.map((step) => (
          <li key={step.key} className={`sync-journey-step sync-journey-step-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
            <span className="sync-journey-mark" aria-hidden="true">{MARK[step.state]}</span>
            <div className="sync-journey-body">
              <span className="sync-journey-label">{step.state === "done" ? step.doneLabel : step.label}</span>
              <span className="sr-only">{step.state === "done" ? " — הושלם" : step.state === "current" ? " — עכשיו" : step.state === "failed" ? " — נעצר כאן" : ""}</span>
              {step.key === "signin" && step.state === "current" && sync.phase === "awaiting_user" && <WindowGuide provider={provider} sync={sync} />}
              {step.key === "signin" && step.state === "current" && sync.phase === "awaiting_bank" && (
                <div className="sync-journey-guide">
                  {provider?.approvalHint && <p>{provider.approvalHint}</p>}
                  {isWaiting(sync) && sync.deadlineAt && <Countdown deadlineAt={sync.deadlineAt} />}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
