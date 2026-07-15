interface SummaryCardProps {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "warning" | "primary";
  sub?: string;
  size?: "default" | "hero";
}

export function SummaryCard({ label, value, tone = "default", sub, size = "default" }: SummaryCardProps) {
  return (
    <div className={`summary-card ${size === "hero" ? "summary-card-hero" : ""}`}>
      <div className="summary-card-label">{label}</div>
      <div className={`summary-card-value mono tone-${tone}`}>{value}</div>
      {sub && <div className="summary-card-sub">{sub}</div>}
    </div>
  );
}
