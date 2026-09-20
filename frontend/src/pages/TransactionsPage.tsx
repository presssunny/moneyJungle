import { LegacyRedirect } from "../components/common/LegacyRedirect";
import { lazy, Suspense, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "../components/common/PageShell";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { TabbedHub } from "../components/common/TabbedHub";
import { Loading } from "../components/common/Loading";
const ExpensesPage=lazy(()=>import("./ExpensesPage"));
const IncomesPage=lazy(()=>import("./IncomesPage"));
const Analysis=lazy(()=>import('./TransactionsAnalysis'));
export default function TransactionsPage() {
 const [params]=useSearchParams(); const [analysisOpen,setAnalysisOpen]=useState(false);
 if(params.get("tab")==="import") return <LegacyRedirect to="/imports"/>;
 return <PageShell><TabbedHub tabs={[
  {key:"expenses",label:"הוצאות",icon:"🧾",element:<Suspense fallback={<Loading/>}><ExpensesPage/></Suspense>},
  {key:"incomes",label:"הכנסות",icon:"💰",element:<Suspense fallback={<Loading/>}><IncomesPage/></Suspense>}
 ]}/><details className="quick-add-disclosure"><summary>הוספה מהירה במשפט אחד</summary><QuickAddBar/></details><details className="home-analysis" onToggle={e=>setAnalysisOpen(e.currentTarget.open)}><summary>ניתוח החודש — סיכומים וגרפים</summary>
 {analysisOpen&&<Suspense fallback={<Loading/>}><Analysis/></Suspense>}</details></PageShell>;
}
