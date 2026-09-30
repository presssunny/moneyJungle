import { useEffect, useState } from "react";
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
interface RowPage {items:ImportRow[];total:number;pageSize:number;pendingCount:number;counts:{included:number;duplicate:number;pending:number};editedCount:number}
export function ImportRowsReview({session,onSaved,onSummary}:{session:ImportSession;onSaved:(s:ImportSession)=>void;onSummary:(pending:number,edited:number)=>void}) {
 const [page,setPage]=useState(1);const [showAll,setShowAll]=useState(false);const [editing,setEditing]=useState<ImportRow|null>(null);const [value,setValue]=useState<RowValue|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const resource=useAsync(async()=> ({...(await api.get<RowPage>(`/imports/sessions/${session.id}/rows`,{params:{page,...(!showAll?{filter:"review"}:{})}})).data,sessionVersion:session.version}),[session.id,session.version,page,showAll]);
 const summary=resource.data;
 useEffect(()=>{if(summary?.sessionVersion===session.version&&!resource.loading&&!resource.error)onSummary(summary.pendingCount,summary.editedCount??0);},[summary,session.version,resource.loading,resource.error,onSummary]);
 const editable=['ready_for_review','needs_input'].includes(session.status);
 const moneyEditable=['expense_sheet','credit'].includes(session.kind);
 async function save(resolution:'include'|'duplicate',candidate?:Candidate){if(!editing||!value)return;setBusy(true);setError('');try{
   const {data}=await api.patch(`/imports/sessions/${session.id}/rows/${editing.rowNumber}`,{version:session.version,resolution,...(moneyEditable?{normalized:value}:{}),candidateId:candidate?.id,candidateKind:candidate?.kind});
   onSaved(data);setEditing(null);setPage(1);
 }catch(e){setError(apiErrorMessage(e));}finally{setBusy(false);}}
 return <><AsyncSection resource={resource} errorTitle="לא ניתן לטעון את שורות המקור" skeleton={<Loading/>}>{data=><>
  <p role="status">{data.counts?`${data.counts.included} תנועות ${["review","completed"].includes(session.status)?"נוספו":session.status==="failed"?"נקראו":"להוספה"} · ${data.counts.duplicate} כבר קיימות · ${data.counts.pending} דורשות החלטה`:`${session.preview.count} תנועות · ${data.pendingCount} דורשות החלטה`}</p>
  {data.pendingCount>0&&!showAll&&<p>מוצגות רק התנועות שעשויות להיות כפולות. בוחרים אם הן כבר קיימות או שצריך להוסיף אותן.</p>}
  <Button variant="ghost" aria-expanded={showAll} onClick={()=>{setShowAll(!showAll);setPage(1);}}>{showAll?'סגירת הפירוט':`צפייה בכל ${session.preview.count} התנועות`}</Button>
  {(showAll||data.pendingCount>0)&&<>
  <Table pageSize={0} rows={data.items} rowKey={r=>r.id} columns={[
   {key:'row',header:'שורה בקובץ',render:r=>r.rowNumber},
   {key:'date',header:'תאריך',render:r=>r.normalized.date?formatDate(r.normalized.date):'חסר תאריך'},
   {key:'name',header:'תיאור',render:r=>r.normalized.name},
   {key:'amount',header:'סכום',render:r=>formatCurrency(r.normalized.amount)},
   {key:'state',header:'החלטה',render:r=>r.resolution==='duplicate'?'כבר נרשמה':r.resolution==='review'?'כפילות חשודה':'תתווסף'},
   {key:'review',header:'בדיקה',render:r=>editable?<Button variant="outline" onClick={()=>{setEditing(r);setValue(r.normalized);setError('');}}>{r.resolution==='review'?`בדיקת שורה ${r.rowNumber}`:`פרטי שורה ${r.rowNumber}`}</Button>:r.outputRef?`מקור: ${r.outputRef.kind} #${r.outputRef.id}`:'לא תתווסף'},
  ]}/>
  {data.total>data.pageSize&&<div className="row-actions"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>הקודם</Button><span>עמוד {page}</span><Button disabled={page*data.pageSize>=data.total} onClick={()=>setPage(p=>p+1)}>הבא</Button></div>}
  </>}
 </>}</AsyncSection>
 {editing&&value&&<Modal open title={`בדיקת שורת מקור ${editing.rowNumber}`} onClose={()=>{if(!busy)setEditing(null);}}>
  <p>במקור: {editing.original.name} · {formatCurrency(editing.original.amount)} · {formatDate(editing.original.date)}</p>
  {moneyEditable?<><Input label="תיאור" value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/><Input label="תאריך" type="date" value={value.date??''} onChange={e=>setValue({...value,date:e.target.value})}/><Input label="סכום (₪)" type="number" step="0.01" value={value.amount} onChange={e=>setValue({...value,amount:Number(e.target.value)})}/>{session.kind==='credit'&&<Input label="מועד חיוב" type="date" value={value.chargeDate??''} onChange={e=>setValue({...value,chargeDate:e.target.value||null})}/>}</>:<p>הסכומים והתאריכים נלקחים מהקובץ. כדי לתקן אותם, מעלים קובץ מתוקן.</p>}
  {editing.candidates.map(c=><div key={`${c.kind}:${c.id}`}><p>תנועה קיימת: {c.name} · {formatCurrency(c.amount)} · {formatDate(c.date)} · #{c.id}</p><Button disabled={busy} variant="outline" onClick={()=>save('duplicate',c)}>זו אותה תנועה — לא להוסיף שוב</Button></div>)}
  {error&&<p role="alert">{error}</p>}<Button disabled={busy||!value.name||!value.date} onClick={()=>save('include')}>{editing.candidates.length?'זו תנועה נפרדת — להוסיף אותה':'שמירת השינויים'}</Button>
 </Modal>}
 </>;
}
