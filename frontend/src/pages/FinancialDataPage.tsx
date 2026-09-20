import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card } from "../components/common/Card";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { FinancialPicturePanel } from "../components/common/FinancialPicturePanel";
import { CoveragePanel } from "../components/common/CoveragePanel";
import { useAsync } from "../hooks/useAsync";
import { getFinancialStatus, listImportSessions } from "../services/journey.service";
export default function FinancialDataPage(){
 const state=useAsync(getFinancialStatus,[]);const sessions=useAsync(listImportSessions,[]);
 const {hash}=useLocation();
 useEffect(()=>{if(state.data&&hash)document.getElementById(hash.slice(1))?.scrollIntoView({block:'start'});},[hash,state.data]);
 return <div className="journey-page financial-data-page"><div className="row-actions"><Link className="btn btn-primary" to="/imports">העלאת קובץ</Link><Link to="/documents">ארכיון מסמכים</Link><Link to="/review">פריטים לבדיקה</Link></div>
 <Card title="קליטות והמשך תהליך"><AsyncSection resource={sessions} errorTitle="לא ניתן לטעון קליטות" skeleton={<Loading/>}>{items=>items.length?<ul className="journey-list">{items.map(s=><li key={s.id}><Link to={`/imports?session=${s.id}`}>{s.fileName}</Link><span>{({completed:'הושלם',review:'נדרשת בדיקה',needs_input:'נדרש מידע',ready_for_review:'מוכן לקליטה',cancelled:'בוטל',failed:'העיבוד נכשל — אפשר לנסות שוב',rolled_back:'הקליטה הוחזרה לאחור',uploaded:'הקובץ נשמר',processing:'בעיבוד'} as Record<string,string>)[s.status]??'בטיפול'}</span></li>)}</ul>:<p>אין עדיין קליטות. אפשר להעלות דוח או לבחור בהזנה ידנית.</p>}</AsyncSection></Card>
 <AsyncSection resource={state} errorTitle="לא ניתן לטעון את המקורות" skeleton={<Loading/>}>{data=><>{data.picture&&<FinancialPicturePanel picture={data.picture} onSaved={state.reload}/>}<CoveragePanel data={data} onSaved={state.reload}/></>}</AsyncSection>
 </div>;
}
