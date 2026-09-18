import { useState } from "react";
import { Input } from "../common/Input";
import { Select } from "../common/Select";
import { Button } from "../common/Button";
import { useLookups } from "../../hooks/useLookups";
import { apiErrorMessage } from "../../services/api";
import { createExpense, updateExpense, type ExpenseInput } from "../../services/finance.service";
import type { Expense } from "../../types/models";
export function ExpenseEditor({initial,expenseId,onSaved,onCancel}:{initial:ExpenseInput;expenseId?:number;onSaved:(expense:Expense)=>void;onCancel:()=>void}){
 const [form,setForm]=useState(initial);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const {expenseCategories,paymentMethods}=useLookups();
 return <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{const payload={...form,businessName:form.businessName||null,description:form.description||null};const saved=expenseId?await updateExpense(expenseId,payload):await createExpense(payload);onSaved(saved);}catch(err){setError(apiErrorMessage(err));}finally{setBusy(false);}}}>
 {error&&<p role="alert" className="error-message">{error}</p>}<div className="form-row"><Input label="סכום (₪)" type="number" step="0.01" min="0.01" required value={form.amount||''} onChange={e=>setForm({...form,amount:Number(e.target.value)})}/><Input label="תאריך" type="date" required value={form.expenseDate.slice(0,10)} onChange={e=>setForm({...form,expenseDate:e.target.value})}/></div><Input label="שם / בית עסק" value={form.businessName??''} onChange={e=>setForm({...form,businessName:e.target.value})}/>
 <div className="form-row"><Select label="קטגוריה" placeholder="ללא קטגוריה" options={expenseCategories.map(c=>({value:c.id,label:c.name}))} value={form.categoryId??''} onChange={e=>setForm({...form,categoryId:e.target.value?Number(e.target.value):null})}/><Select label="אמצעי תשלום" placeholder="לא צוין" options={paymentMethods.map(m=>({value:m.id,label:m.name}))} value={form.paymentMethodId??''} onChange={e=>setForm({...form,paymentMethodId:e.target.value?Number(e.target.value):null})}/></div>
 <Input label="הערה" value={form.description??''} onChange={e=>setForm({...form,description:e.target.value})}/><div className="modal-actions"><Button type="submit" disabled={busy}>שמירה</Button><Button type="button" disabled={busy} variant="ghost" onClick={onCancel}>ביטול</Button></div>
 </form>;
}
