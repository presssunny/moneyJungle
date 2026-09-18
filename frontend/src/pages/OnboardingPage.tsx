import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PRODUCT_NAME } from "../app/brand";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { api, apiErrorMessage } from "../services/api";
import { getFinancialStatus, finishOnboarding } from "../services/journey.service";
export default function OnboardingPage(){
 const navigate=useNavigate();const state=useAsync(getFinancialStatus,[]);const [reviewed,setReviewed]=useState(false);const [empty,setEmpty]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function finish(){setBusy(true);setError('');try{await finishOnboarding(empty);navigate('/',{replace:true});}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <div className="journey-page"><h1>ברוכים הבאים ל־{PRODUCT_NAME}</h1><p>איפה אנחנו עומדים, מה צפוי, ומה כדאי לעשות עכשיו.</p><Card title="שלושה צעדים לתמונה הראשונה"><ol className="journey-steps"><li><Link to="/imports">העלאת דוח ראשון</Link> — זיהוי, שאלות ותצוגה מקדימה לפני קליטה.</li><li><Link to="/review">בדיקת הנתונים</Link> — אישור אשראי, התאמות והשלמת פרטים.</li><li><Link to="/data">בדיקת המקורות וההתחייבויות</Link> — מה נכלל בתמונה ומה עדיין חסר. כאן אפשר גם לבחור הזנה ידנית.</li></ol></Card>
 <AsyncSection resource={state} errorTitle="לא ניתן לטעון את ההתקדמות" skeleton={<Loading/>}>{data=><Card title="בדיקת התמונה הראשונה"><p>{data.issues.filter(i=>i.blocking).length} פריטים מחייבים השלמה לפני סיום.</p>{data.blockers.length>0&&<details open><summary>מגבלות התמונה הנוכחית</summary><ul>{data.blockers.map(b=><li key={b}>{b}</li>)}</ul></details>}<p><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> בדקתי את הנתונים והבנתי איזה מידע עדיין חסר</label></p>{data.profile.scope?.manualOnly&&<p><label><input type="checkbox" checked={empty} onChange={e=>setEmpty(e.target.checked)}/> אין כרגע פעילות לרישום — אתחיל להזין בהמשך</label></p>}<Button disabled={busy||!reviewed||!data.profile.scope||data.issues.some(i=>i.blocking)} onClick={finish}>סיום ההיכרות</Button></Card>}</AsyncSection>
 {error&&<p role="alert" className="error-message">{error}</p>}<Button variant="ghost" disabled={busy} onClick={async()=>{setBusy(true);try{await api.post('/journey/onboarding/defer');navigate('/');}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}}>להמשיך מאוחר יותר</Button></div>;
}
