import { lazy, Suspense, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { PageShell } from "../components/common/PageShell";
import { QuickAddBar } from "../components/common/QuickAddBar";
import { TabbedHub } from "../components/common/TabbedHub";
import { Loading } from "../components/common/Loading";
import ExpensesPage from "./ExpensesPage";
import IncomesPage from "./IncomesPage";
const Analysis=lazy(()=>import('./TransactionsAnalysis'));
export default function TransactionsPage() {
 const [params]=useSearchParams(); const [analysisOpen,setAnalysisOpen]=useState(false);
 if(params.get("tab")==="import") return <Navigate to="/imports" replace/>;
 return <PageShell><QuickAddBar/><TabbedHub tabs={[
  {key:"expenses",label:"הוצאות",icon:"🧾",element:<ExpensesPage/>},
  {key:"incomes",label:"הכנסות",icon:"💰",element:<IncomesPage/>}
 ]}/><details className="home-analysis" onToggle={e=>setAnalysisOpen(e.currentTarget.open)}><summary>ניתוח החודש — סיכומים וגרפים</summary>
 {analysisOpen&&<Suspense fallback={<Loading/>}><Analysis/></Suspense>}</details></PageShell>;
}
