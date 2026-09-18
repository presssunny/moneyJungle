import { useState } from "react";
import { api, apiErrorMessage } from "../../services/api";
import type { ImportSession } from "../../services/journey.service";
import { useAsync } from "../../hooks/useAsync";
import { AsyncSection } from "./AsyncSection";
import { Loading } from "./Loading";
import { Table } from "./Table";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { formatCurrency, formatDate } from "../../utils/format";
interface RowValue {date:string|null;name:string;amount:number;chargeDate?:string|null}
interface Candidate extends RowValue {kind:string;id:number}
interface ImportRow {id:number;rowNumber:number;original:RowValue;normalized:RowValue;resolution:string;candidates:Candidate[];outputRef:{kind:string;id:number}|null}
interface RowPage {items:ImportRow[];total:number;pageSize:number;pendingCount:number}
export function ImportRowsReview({session,onSaved}:{session:ImportSession;onSaved:(s:ImportSession)=>void}) {
 const [page,setPage]=useState(1);const [editing,setEditing]=useState<ImportRow|null>(null);const [value,setValue]=useState<RowValue|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const resource=useAsync(async()=> (await api.get(`/imports/sessions/${session.id}/rows`,{params:{page}})).data as RowPage,[session.id,session.version,page]);
 const editable=['ready_for_review','needs_input'].includes(session.status);
 const moneyEditable=['expense_sheet','credit'].includes(session.kind);
 async function save(resolution:'include'|'duplicate',candidate?:Candidate){if(!editing||!value)return;setBusy(true);setError('');try{
   const {data}=await api.patch(`/imports/sessions/${session.id}/rows/${editing.rowNumber}`,{version:session.version,resolution,...(moneyEditable?{normalized:value}:{}),candidateId:candidate?.id,candidateKind:candidate?.kind});
   onSaved(data);setEditing(null);
 }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <><AsyncSection resource={resource} errorTitle="לא ניתן לטעון את שורות המקור" skeleton={<Loading/>}>{data=><>
  <p>{data.total} שורות מקור · {data.pendingCount} כפילויות חשודות לבדיקה</p>
  <Table pageSize={0} rows={data.items} rowKey={r=>r.id} columns={[
   {key:'row',header:'שורת מקור',render:r=>r.rowNumber},
   {key:'date',header:'תאריך',render:r=>r.normalized.date?formatDate(r.normalized.date):'חסר תאריך'},
   {key:'name',header:'תיאור',render:r=>r.normalized.name},
   {key:'amount',header:'סכום',render:r=>formatCurrency(r.normalized.amount)},
   {key:'state',header:'החלטה',render:r=>r.resolution==='duplicate'?'כבר נרשמה':r.resolution==='review'?'כפילות חשודה':'לקליטה'},
   {key:'review',header:'בדיקה',render:r=>editable?<Button variant="outline" onClick={()=>{setEditing(r);setValue(r.normalized);setError('');}}>בדיקת שורה {r.rowNumber}</Button>:r.outputRef?`מקור: ${r.outputRef.kind} #${r.outputRef.id}`:'לא נקלטה'},
  ]}/>
  <div className="row-actions"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>הקודם</Button><span>עמוד {page}</span><Button disabled={page*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>הבא</Button></div>
 </>}</AsyncSection>
 {editing&&value&&<Modal open title={`בדיקת שורת מקור ${editing.rowNumber}`} onClose={()=>{if(!busy)setEditing(null);}}>
  <p>במקור: {editing.original.name} · {formatCurrency(editing.original.amount)} · {formatDate(editing.original.date)}</p>
  {moneyEditable?<><Input label="תיאור" value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/><Input label="תאריך" type="date" value={value.date??''} onChange={e=>setValue({...value,date:e.target.value})}/><Input label="סכום (₪)" type="number" step="0.01" value={value.amount} onChange={e=>setValue({...value,amount:Number(e.target.value)})}/>{session.kind==='credit'&&<Input label="מועד ירידה בבנק" type="date" value={value.chargeDate??''} onChange={e=>setValue({...value,chargeDate:e.target.value||null})}/>}</>:<p>המספרים מאומתים מול דוח המקור. לתיקון סכומים או תאריכים יש להעלות קובץ מתוקן.</p>}
  {editing.candidates.map(c=><div key={`${c.kind}:${c.id}`}><p>תנועה קיימת: {c.name} · {formatCurrency(c.amount)} · {formatDate(c.date)} · #{c.id}</p><Button disabled={busy} variant="outline" onClick={()=>save('duplicate',c)}>זו אותה תנועה — לא לקלוט שוב</Button></div>)}
  {error&&<p role="alert">{error}</p>}<Button disabled={busy||!value.name||!value.date} onClick={()=>save('include')}>זו תנועה נפרדת — שמירת השורה לקליטה</Button>
 </Modal>}
 </>;
}
