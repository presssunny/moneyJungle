interface SummaryCardProps {
  label: string;
  value: string;
  tone?: "default" | "success" | "danger" | "warning" | "primary";
  sub?: string;
}

export function SummaryCard({ label, value, tone = "default", sub }: SummaryCardProps) {
  return (
    <div className="summary-card">
      <div className="summary-card-label">{label}</div>
      <div className={`summary-card-value mono tone-${tone}`}>{value}</div>
      {sub && <div className="summary-card-sub">{sub}</div>}
    </div>
  );
}
