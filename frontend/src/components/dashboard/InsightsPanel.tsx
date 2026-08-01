import type { DashboardInsights } from "../../types/models";
import { formatCurrency } from "../../utils/format";

function scoreTone(score: number): string {
  if (score >= 80) return "score-good";
  if (score >= 60) return "score-ok";
  if (score >= 40) return "score-warn";
  return "score-bad";
}

/** Circular financial-health gauge + safe-to-spend + smart insight list. */
export function InsightsPanel({ data }: { data: DashboardInsights }) {
  const score = data.healthScore;
  const circumference = 2 * Math.PI * 52;
  const dash = score !== null ? (score / 100) * circumference : 0;

  return (
    <div className="insights-panel">
      <div className="insights-gauge">
        {score !== null ? (
          <div className="gauge-ring">
            <svg viewBox="0 0 120 120" width="130" height="130">
              <circle cx="60" cy="60" r="52" className="gauge-track" fill="none" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className={`gauge-value ${scoreTone(score)}`}
                fill="none"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference}`}
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="gauge-center">
              <span className="gauge-score">{score}</span>
              <span className="gauge-outof">/100</span>
            </div>
          </div>
        ) : (
          <div className="gauge-empty">✨</div>
        )}
        <div className="gauge-label">בריאות פיננסית</div>
        <div className="gauge-sublabel">{data.scoreLabel}</div>
      </div>

      <div className="insights-content">
        {data.projection && (
          <div className="projection-line">
            בקצב הנוכחי החודש ייגמר עם{" "}
            <strong className={data.projection.projectedBalance >= 0 ? "text-success" : "text-danger"}>
              {formatCurrency(data.projection.projectedBalance)}
            </strong>{" "}
            <span className="text-muted">(צפי הוצאות {formatCurrency(data.projection.projectedExpenses)})</span>
          </div>
        )}
        <ul className="insights-list">
          {data.insights.map((insight, i) => (
            <li key={i} className={`insight insight-${insight.tone}`}>
              <span className="insight-icon">{insight.icon}</span>
              <span>{insight.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
