import { TabbedHub } from "../components/common/TabbedHub";
import BankPage from "./BankPage";
import CreditPage from "./CreditPage";
import LoansPage from "./LoansPage";
import SavingsPage from "./SavingsPage";

/** Everything you hold or owe in one hub (replaces separate בנק / אשראי / הלוואות / חיסכון tabs). */
export default function AccountsPage() {
  return (
    <TabbedHub
      tabs={[
        { key: "credit", label: "אשראי", icon: "💳", element: <CreditPage /> },
        { key: "bank", label: "בנק", icon: "🏦", element: <BankPage /> },
        { key: "loans", label: "הלוואות וחובות", icon: "📉", element: <LoansPage /> },
        { key: "savings", label: "חיסכון ויעדים", icon: "🐷", element: <SavingsPage /> },
      ]}
    />
  );
}
