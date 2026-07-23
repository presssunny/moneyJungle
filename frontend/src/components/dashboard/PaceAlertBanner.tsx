import type { PaceAlert } from "../../types/models";

const ICON: Record<PaceAlert["tone"], string> = {
  bad: "🚨",
  warning: "⚠️",
  good: "✅",
};

/**
 * Proactive month-pace banner: forecasts end-of-month spend vs the target and
 * warns BEFORE the month closes, with a concrete daily budget to get back on track.
 */
export function PaceAlertBanner({ data }: { data: PaceAlert }) {
  return (
    <div className={`pace-banner pace-banner-${data.tone}`} role="status">
      <span className="pace-banner-icon" aria-hidden="true">
        {ICON[data.tone]}
      </span>
      <div className="pace-banner-body">
        <strong className="pace-banner-title">{data.title}</strong>
        <span className="pace-banner-detail">{data.detail}</span>
      </div>
    </div>
  );
}
