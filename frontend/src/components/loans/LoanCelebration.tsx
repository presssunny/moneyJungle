import { useEffect, useMemo, useState } from "react";
import { Button } from "../common/Button";
import type { LoanEvent } from "../../types/models";
import { formatCurrency } from "../../utils/format";

/**
 * Paying off a loan is the biggest thing that happens in this app. When the app
 * detects one it says so properly instead of quietly moving a row to another
 * list.
 *
 * Confetti is hand-rolled (a few absolutely-positioned divs) rather than pulled
 * from a library — it is 30 elements and one keyframe, and the project carries
 * no animation dependency. It is skipped entirely under `prefers-reduced-motion`,
 * where the message alone carries the news.
 */

const COLOURS = ["var(--primary)", "var(--success)", "var(--secondary)", "var(--warning)"];
const PIECES = 34;

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.2 + Math.random() * 1.4,
        rotate: Math.random() * 360,
        colour: COLOURS[i % COLOURS.length],
        wide: Math.random() > 0.5,
      })),
    []
  );

  return (
    <div className="confetti" aria-hidden>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti-piece"
          style={{
            left: `${piece.left}%`,
            background: piece.colour,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`,
            width: piece.wide ? 10 : 6,
            height: piece.wide ? 6 : 12,
          }}
        />
      ))}
    </div>
  );
}

interface Props {
  event: LoanEvent;
  /** How many loans are still running — the "what now" line. */
  remainingActive: number;
  onClose: () => void;
}

export function LoanCelebration({ event, remainingActive, onClose }: Props) {
  const [motionOk, setMotionOk] = useState(false);

  useEffect(() => {
    setMotionOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="celebrate-overlay" onClick={onClose}>
      {motionOk && <Confetti />}
      <div
        className="celebrate-card"
        role="alertdialog"
        aria-labelledby="celebrate-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="celebrate-icon" aria-hidden>
          🎉
        </div>
        <h2 className="celebrate-title" id="celebrate-title">
          מזל טוב! סגרת את ההלוואה
        </h2>
        <p className="celebrate-name">
          {event.loanName}
          {event.trackNumber && <span className="text-muted"> · מסלול {event.trackNumber}</span>}
        </p>

        <div className="celebrate-stats">
          <div className="celebrate-stat celebrate-stat-hero">
            <span className="celebrate-stat-value mono">{formatCurrency(event.freedMonthlyPayment)}</span>
            <span className="celebrate-stat-label">התפנו לך בכל חודש</span>
          </div>
          {/* Shown only when a real schedule backed the figure — never a 0 that
              would read as "you saved nothing" (IA §1.2). */}
          {event.savedInterest > 0 && (
            <div className="celebrate-stat">
              <span className="celebrate-stat-value mono">{formatCurrency(event.savedInterest)}</span>
              <span className="celebrate-stat-label">ריבית עתידית שנחסכה</span>
            </div>
          )}
          {event.closureCost > 0 && (
            <div className="celebrate-stat">
              <span className="celebrate-stat-value mono text-muted">{formatCurrency(event.closureCost)}</span>
              <span className="celebrate-stat-label">עמלות סגירה</span>
            </div>
          )}
        </div>

        <p className="celebrate-next">
          {remainingActive === 0
            ? "לא נשארו לך הלוואות פעילות. 🌴"
            : remainingActive === 1
              ? "נותרה לך הלוואה פעילה אחת."
              : `נותרו לך ${remainingActive} הלוואות פעילות.`}
        </p>

        <Button onClick={onClose}>מעולה, תודה</Button>
      </div>
    </div>
  );
}
