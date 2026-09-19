export type MetricName = "creditCharge" | "cash" | "allowance" | "commitments" | "income" | "expense" | "surplus";
export interface MetricComponent {
  key: string;
  label: string;
  value: number | null;
  date?: string;
  detail?: string;
  to: string;
}
export interface FinancialMetric {
  name: MetricName;
  value: number | null;
  currency: "ILS";
  state: "recorded" | "partial" | "provisional" | "unavailable";
  asOf: string;
  period: { from: string; to: string };
  sources: Array<{ key: string; label: string; to: string }>;
  coverage: string;
  missingData: string[];
  assumptions: string[];
  formula: string;
  calculationVersion: string;
  dataVersion: string;
  components: MetricComponent[];
  total: number;
  page: number;
  pageSize: number;
}
