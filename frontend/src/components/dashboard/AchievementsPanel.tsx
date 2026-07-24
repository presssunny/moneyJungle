import type { Achievements } from "../../types/models";

/** Celebrate-don't-shame gamification: a streak headline + earnable badge grid. */
export function AchievementsPanel({ data }: { data: Achievements }) {
  return (
    <div className="card achievements-panel">
      <div className="achievements-head">
        <div className="achievements-streak">
          <span className="achievements-streak-icon" aria-hidden>
            {data.streak.months > 0 ? "🔥" : "🎯"}
          </span>
          <div>
            <div className="achievements-streak-count mono">
              {data.streak.months > 0 ? `${data.streak.months} חודשים ברצף` : "מתחילות רצף"}
            </div>
            <div className="achievements-streak-label">{data.streak.label}</div>
          </div>
        </div>
        <div className="achievements-earned">
          {data.earnedCount}/{data.badges.length} תגים
        </div>
      </div>

      <div className="badge-grid">
        {data.badges.map((badge) => (
          <div key={badge.key} className={`badge ${badge.earned ? "badge-earned" : "badge-locked"}`}>
            <span className="badge-icon" aria-hidden>
              {badge.icon}
            </span>
            <div className="badge-body">
              <div className="badge-title">
                {badge.title} {badge.earned && <span aria-hidden>✓</span>}
              </div>
              <div className="badge-desc">{badge.description}</div>
              {!badge.earned && badge.progress != null && badge.progress > 0 && (
                <div className="badge-bar">
                  <div className="badge-bar-fill" style={{ width: `${Math.min(100, badge.progress)}%` }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
