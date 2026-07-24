import { useState } from "react";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { TabbedHub } from "../components/common/TabbedHub";
import ExpensesPage from "./ExpensesPage";
import ImportsPage from "./ImportsPage";
import IncomesPage from "./IncomesPage";

/** Money in & money out in one place (replaces separate הכנסות / הוצאות / ייבוא tabs). */
export default function TransactionsPage() {
  // Bump to remount the active tab so it re-fetches after a quick add.
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <>
      <QuickAddBar onAdded={() => setRefreshKey((k) => k + 1)} />
      <TabbedHub
        key={refreshKey}
        tabs={[
          { key: "expenses", label: "הוצאות", icon: "🧾", element: <ExpensesPage /> },
          { key: "incomes", label: "הכנסות", icon: "💰", element: <IncomesPage /> },
          { key: "import", label: "ייבוא אקסל", icon: "📂", element: <ImportsPage /> },
        ]}
      />
    </>
  );
}
