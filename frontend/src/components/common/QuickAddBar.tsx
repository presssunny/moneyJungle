import { Link } from "react-router-dom";
import { useState } from "react";
import { quickAddExpense, deleteExpense } from "../../services/finance.service";
import { apiErrorMessage } from "../../services/api";
import type { Expense } from "../../types/models";
import { formatCurrency, formatDate } from "../../utils/format";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { ExpenseEditor } from "../expenses/ExpenseEditor";
export function QuickAddBar({onAdded}:{onAdded?:()=>void}){
 const [previous,setPrevious]=useState<Expense[]>([]);
 const [text,setText]=useState('');const [busy,setBusy]=useState(false);const [saved,setSaved]=useState<Expense|null>(null);const [editing,setEditing]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 async function add(e:React.FormEvent){e.preventDefault();if(busy||!text.trim())return;setBusy(true);setError('');setMessage('');try{const result=await quickAddExpense(text.trim());if(saved)setPrevious(rows=>[saved,...rows].slice(0,10));setSaved(result.expense);setText('');onAdded?.();}catch(err){setError(apiErrorMessage(err,'לא ניתן להוסיף את ההוצאה'));}finally{setBusy(false);}}
 async function undo(){if(!saved||busy)return;setBusy(true);setError('');try{await deleteExpense(saved.id);setSaved(null);setMessage('ההוספה בוטלה');onAdded?.();}catch(err){setError(apiErrorMessage(err,'לא ניתן לבטל את ההוספה. אפשר לנסות שוב'));}finally{setBusy(false);}}
 return <div className="quick-add"><form className="quick-add-form" onSubmit={add}><input className="quick-add-input" value={text} onChange={e=>setText(e.target.value)} placeholder='הוספה מהירה: שופרסל 250 או קפה 18 אתמול' aria-label="הוספת הוצאה בשפה חופשית" maxLength={255}/><Button type="submit" disabled={busy||!text.trim()}>הוספה</Button></form>
 {saved&&<div className="quick-add-result" role="status"><p>נשמרה הוצאה: <strong>{saved.businessName||'ללא בית עסק'}</strong> · {formatCurrency(Number(saved.amount))} · {saved.category?.name??'ללא קטגוריה'} · {formatDate(saved.expenseDate)}</p><p className="text-muted">{saved.description}</p><div className="row-actions"><Button size="sm" variant="outline" disabled={busy} onClick={()=>setEditing(true)}>עריכה</Button><Button size="sm" variant="ghost" disabled={busy} onClick={undo}>ביטול ההוספה</Button><Button size="sm" variant="ghost" onClick={()=>setSaved(null)}>סגירה</Button></div></div>}
 {previous.length>0&&<details><summary>הוספות קודמות</summary><ul>{previous.map(row=><li key={row.id}><Link to={`/transactions?tab=expenses&month=${row.expenseDate.slice(0,7)}&q=${encodeURIComponent(row.businessName??row.description??"")}`}>{row.businessName||row.description||"הוצאה"} · {formatCurrency(Number(row.amount))} · {formatDate(row.expenseDate)}</Link></li>)}</ul></details>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="quick-add-error">{error}</p>}
 <Modal title="תיקון ההוצאה שנוספה" open={editing&&!!saved} onClose={()=>setEditing(false)}>{saved&&<ExpenseEditor key={saved.id} expenseId={saved.id} initial={{amount:Number(saved.amount),expenseDate:saved.expenseDate.slice(0,10),categoryId:saved.categoryId,paymentMethodId:saved.paymentMethodId,businessName:saved.businessName,description:saved.description,isRecurring:saved.isRecurring}} onSaved={expense=>{setSaved(expense);setEditing(false);onAdded?.();}} onCancel={()=>setEditing(false)}/>}</Modal>
 </div>;
}
