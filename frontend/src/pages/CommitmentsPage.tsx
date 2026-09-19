import { MetricExplanation } from "../components/common/MetricExplanation";
import { useState } from "react";
import { Link } from "react-router-dom";
import { TabbedHub } from "../components/common/TabbedHub";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { Input } from "../components/common/Input";
import { Select } from "../components/common/Select";
import { Modal } from "../components/common/Modal";
import { Table } from "../components/common/Table";
import { AsyncSection } from "../components/common/AsyncSection";
import { Loading } from "../components/common/Loading";
import { useAsync } from "../hooks/useAsync";
import { apiErrorMessage } from "../services/api";
import { getCommitments, decideCommitment, type Commitment } from "../services/journey.service";
import { formatCurrency, formatDate } from "../utils/format";
import CalendarPage from "./CalendarPage";
import RecurringPage from "./RecurringPage";
import SubscriptionsPage from "./SubscriptionsPage";
function Agenda(){
 const resource=useAsync(getCommitments,[]);const [selected,setSelected]=useState<Commitment|null>(null);const [decision,setDecision]=useState('unpaid');const [note,setNote]=useState('');const [related,setRelated]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function save(){if(!selected)return;setBusy(true);setError('');try{await decideCommitment({key:selected.key,fingerprint:selected.fingerprint,decision,note,...(decision==='duplicate'?{relatedEventKey:related}:{})});setSelected(null);resource.reload();}catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <Card title="מה צפוי ומה כבר שולם"><p>חיובים רשומים שמועד התשלום שלהם עבר ובחודשיים הקרובים, לצד חיובי אשראי עתידיים ידועים. בדקו אילו חיובי עבר כבר שולמו, וחפיפה בין מנויים, תשלומים קבועים ואשראי.</p><AsyncSection resource={resource} errorTitle="לא ניתן לטעון התחייבויות" skeleton={<Loading/>}>{events=>events.length?<Table rows={events} rowKey={e=>e.key} columns={[{key:'date',header:'תאריך',render:e=>formatDate(e.date)},{key:'name',header:'התחייבות',render:e=><Link to={e.to}>{e.name}</Link>},{key:'amount',header:'סכום',render:e=>e.amount===null?'לא ידוע':formatCurrency(e.amount)},{key:'decision',header:'בדיקה',render:e=><Button size="sm" variant="outline" onClick={()=>{setSelected(e);setDecision(e.decision??'unpaid');setNote(e.note??'');setRelated('');setError('');}}>{({paid:'שולם',unpaid:'טרם שולם',duplicate:'כלול בחיוב אחר'} as Record<string,string>)[e.decision??'']??'נדרשת בדיקה'}</Button>}]}/>:<p>לא רשומות התחייבויות. אין בכך אישור שלא יהיו הוצאות.</p>}</AsyncSection>
 <Modal title={selected?.name??'בדיקת התחייבות'} open={!!selected} onClose={()=>!busy&&setSelected(null)}><p>סימון כשולם מציין שהסכום כבר משתקף ביתרת הבנק. הוא לא יוצר תשלום ולא משנה את היתרה.</p><Select label="מצב" value={decision} options={[{value:'unpaid',label:'טרם שולם — יש לשריין את הסכום'},{value:'paid',label:'כבר שולם ונכלל ביתרת הבנק'},{value:'duplicate',label:'כלול בחיוב אחר'}]} onChange={e=>setDecision(e.target.value)}/>{decision==='duplicate'&&<Select label="החיוב שכולל סכום זה" value={related} placeholder="בחירת חיוב" options={(resource.data??[]).filter(e=>e.key!==selected?.key&&e.decision==='unpaid').map(e=>({value:e.key,label:`${e.name} · ${formatDate(e.date)}`}))} onChange={e=>setRelated(e.target.value)}/>}<Input label="הסבר / מקור הבדיקה" value={note} onChange={e=>setNote(e.target.value)} maxLength={255}/>{error&&<p role="alert">{error}</p>}<Button disabled={busy||note.trim().length<3||(decision==='duplicate'&&!related)} onClick={save}>שמירת הבדיקה</Button></Modal>
 </Card>;
}
export default function CommitmentsPage(){return <><MetricExplanation title="סכום ההתחייבויות והמקורות" metric="commitments"/><TabbedHub tabs={[{key:'agenda',label:'תשלומים ובדיקה',icon:'📅',element:<Agenda/>},{key:'calendar',label:'לוח שנה',icon:'🗓️',element:<CalendarPage/>},{key:'recurring',label:'תשלומים קבועים',icon:'🔁',element:<RecurringPage/>},{key:'subscriptions',label:'מנויים',icon:'📺',element:<SubscriptionsPage/>}]}/></>;}
