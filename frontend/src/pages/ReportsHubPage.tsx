import { TabbedHub } from "../components/common/TabbedHub";
import ComparisonPage from "./ComparisonPage";
import ReportsPage from "./ReportsPage";

/** Reporting hub — the monthly report and the month-comparison share the same data. */
export default function ReportsHubPage() {
  return (
    <TabbedHub
      tabs={[
        { key: "monthly", label: "דוח חודשי", icon: "📈", element: <ReportsPage /> },
        { key: "comparison", label: "השוואת חודשים", icon: "⚖️", element: <ComparisonPage /> },
      ]}
    />
  );
}
