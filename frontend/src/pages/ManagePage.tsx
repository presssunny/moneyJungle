import { TabbedHub } from "../components/common/TabbedHub";
import AlertsPage from "./AlertsPage";
import CalendarPage from "./CalendarPage";
import CategoriesRulesPage from "./CategoriesRulesPage";
import FamilyPage from "./FamilyPage";
import PaymentMethodsPage from "./PaymentMethodsPage";
import RecurringPage from "./RecurringPage";
import SettingsPage from "./SettingsPage";
import SubscriptionsPage from "./SubscriptionsPage";

/**
 * Setup & occasional screens, pulled out of the primary rail (progressive
 * disclosure). Planning items (recurring, subscriptions, calendar, alerts) sit
 * first, then configuration (categories, payment methods, family, preferences).
 */
export default function ManagePage() {
  return (
    <TabbedHub
      tabs={[
        { key: "recurring", label: "תשלומים קבועים", icon: "🔁", element: <RecurringPage /> },
        { key: "subscriptions", label: "מנויים", icon: "📺", element: <SubscriptionsPage /> },
        { key: "calendar", label: "לוח שנה", icon: "📅", element: <CalendarPage /> },
        { key: "alerts", label: "התראות", icon: "🚨", element: <AlertsPage /> },
        { key: "categories", label: "קטגוריות וחוקים", icon: "🏷️", element: <CategoriesRulesPage /> },
        { key: "payment-methods", label: "אמצעי תשלום", icon: "💼", element: <PaymentMethodsPage /> },
        { key: "family", label: "משפחה", icon: "👨‍👩‍👧", element: <FamilyPage /> },
        { key: "settings", label: "העדפות", icon: "⚙️", element: <SettingsPage /> },
      ]}
    />
  );
}
