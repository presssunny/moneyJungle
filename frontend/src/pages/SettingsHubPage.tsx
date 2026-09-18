import { TabbedHub } from "../components/common/TabbedHub";
import CategoriesRulesPage from "./CategoriesRulesPage";
import PaymentMethodsPage from "./PaymentMethodsPage";
import FamilyPage from "./FamilyPage";
import SettingsPage from "./SettingsPage";
export default function SettingsHubPage(){return <TabbedHub tabs={[{key:'preferences',label:'העדפות',icon:'⚙️',element:<SettingsPage/>},{key:'categories',label:'קטגוריות וחוקים',icon:'🏷️',element:<CategoriesRulesPage/>},{key:'payment-methods',label:'אמצעי תשלום',icon:'💼',element:<PaymentMethodsPage/>},{key:'family',label:'משפחה',icon:'👨‍👩‍👧',element:<FamilyPage/>}]}/>;}
