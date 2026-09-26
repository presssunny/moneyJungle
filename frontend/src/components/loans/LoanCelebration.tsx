import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import type { LoanEvent } from "../../types/models";
import { formatCurrency } from "../../utils/format";

/**
 * Paying off a loan is the biggest thing that happens here, so it gets said
 * properly rather than moving a row to another list. Confetti is 30 divs and one
 * keyframe (no animation dependency), skipped under `prefers-reduced-motion`.
 */

const COLOURS = ["var(--primary)", "var(--success)", "var(--secondary)", "var(--warning)"];
const PIECES = 34;

// Scattered but deterministic, so rendering stays pure and every celebration looks the same.
const scatter = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI = Array.from({ length: PIECES }, (_, i) => ({
  id: i,
  left: scatter(i, 1) * 100,
  delay: scatter(i, 2) * 0.6,
  duration: 2.2 + scatter(i, 3) * 1.4,
  rotate: scatter(i, 4) * 360,
  colour: COLOURS[i % COLOURS.length],
  wide: scatter(i, 5) > 0.5,
}));

function Confetti() {
  const pieces = CONFETTI;

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
  const [motionOk] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
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
