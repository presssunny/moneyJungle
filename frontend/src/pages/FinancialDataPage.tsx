import { Link } from "react-router-dom";
import { Card } from "../components/common/Card";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { CoveragePanel } from "../components/common/CoveragePanel";
import { useAsync } from "../hooks/useAsync";
import { getFinancialStatus, listImportSessions } from "../services/journey.service";
export default function FinancialDataPage(){
 const state=useAsync(getFinancialStatus,[]);const sessions=useAsync(listImportSessions,[]);
 return <div className="journey-page"><div className="row-actions"><Link className="btn btn-primary" to="/imports">העלאת קובץ</Link><Link to="/documents">ארכיון מסמכים</Link><Link to="/review">פריטים לבדיקה</Link></div>
 <Card title="קליטות והמשך תהליך"><AsyncSection resource={sessions} errorTitle="לא ניתן לטעון קליטות" skeleton={<Loading/>}>{items=>items.length?<ul className="journey-list">{items.map(s=><li key={s.id}><Link to={`/imports?session=${s.id}`}>{s.fileName}</Link><span>{({completed:'הושלם',review:'נדרשת בדיקה',needs_input:'נדרש מידע',ready_for_review:'מוכן לקליטה',cancelled:'בוטל'} as Record<string,string>)[s.status]??'בטיפול'}</span></li>)}</ul>:<p>אין עדיין קליטות. אפשר להעלות דוח או לבחור בהזנה ידנית.</p>}</AsyncSection></Card>
 <AsyncSection resource={state} errorTitle="לא ניתן לטעון את המקורות" skeleton={<Loading/>}>{data=><CoveragePanel data={data} onSaved={state.reload}/>}</AsyncSection>
 </div>;
}
