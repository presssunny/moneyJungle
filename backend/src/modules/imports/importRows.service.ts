import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { fingerprint, json } from "../journey/journey.utils";

export interface PreviewRow { date: string | null; name: string; amount: number; chargeDate?: string | null; installment?: number | null }
export type ImportOrigin = "file" | "sync";
export interface SourceRef { kind: "expense" | "credit" | "bank" | "loan_schedule"; id: number; fingerprint: string }
interface Candidate extends SourceRef { date: string; name: string; amount: number; installment?: number | null }
export const rowEditSchema = z.object({
  version: z.number().int().nonnegative(),
  normalized: z.object({date:z.iso.date().nullable(),name:z.string().trim().min(1).max(255),amount:z.number().finite().min(-9999999999).max(9999999999),chargeDate:z.iso.date().nullable().optional()}).optional(),
  resolution:z.enum(["include","duplicate"]),
  candidateId:z.number().int().positive().optional(), candidateKind:z.enum(["expense","credit","bank","loan_schedule"]).optional(),
}).strict();

async function candidatesFor(userId:number,kind:string,answers:{accountId?:number;cardId?:number}):Promise<Candidate[]> {
  if(kind==="bank") {
    const rows=await prisma.bankTransaction.findMany({where:{userId,bankAccountId:answers.accountId??-1},orderBy:{id:"asc"}});
    return rows.map(r=>({kind:"bank",id:r.id,fingerprint:fingerprint(r),date:r.transactionDate.toISOString().slice(0,10),name:r.description??"",amount:Number(r.amount)*(r.type==="deposit"?1:-1)}));
  }
  if(!["credit","expense_sheet"].includes(kind)) return [];
  const [expenses,credit]=await Promise.all([
    prisma.expense.findMany({where:{userId},orderBy:{id:"asc"}}),
    prisma.creditTransaction.findMany({where:{userId,...(kind==="credit"?{OR:[{cardId:answers.cardId??null},{cardId:null}]}:{})},orderBy:{id:"asc"}}),
  ]);
  return [
    ...expenses.map(r=>({kind:"expense" as const,id:r.id,fingerprint:fingerprint(r),date:r.expenseDate.toISOString().slice(0,10),name:r.businessName??"",amount:Number(r.amount)})),
    ...credit.map(r=>({kind:"credit" as const,id:r.id,fingerprint:fingerprint(r),date:r.transactionDate.toISOString().slice(0,10),name:r.businessName,amount:Number(r.amount),installment:r.installmentNumber})),
  ];
}
// Two installments of one purchase share date, name and amount; only their number tells them apart.
const cents=(amount:number)=>Math.round(amount*100);
const sameInstalment=(r:PreviewRow,c:Candidate)=>!(r.installment!=null&&c.installment!=null&&r.installment!==c.installment);
const matches=(r:PreviewRow,c:Candidate)=>r.date===c.date&&r.name.trim()===c.name.trim()&&cents(r.amount)===cents(c.amount)&&sameInstalment(r,c);
const monthEnd=(day:string)=>{const [y,m]=day.split("-").map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10);};
// The bank's website words a row differently from its files, so a synced row with a stored
// row's day and signed amount may be that row. Instalment n>1 bought on the 29th–31st comes
// back clamped to its month's end, earlier than the stored purchase day (banker 2026-10-17).
// Bank and card rows only: a manual expense is not a reworded copy of a card charge.
const near=(r:PreviewRow,c:Candidate)=>c.kind!=="expense"&&cents(r.amount)===cents(c.amount)&&sameInstalment(r,c)
  &&!!r.date&&(r.date===c.date||(r.installment!=null&&r.installment>1&&r.date.slice(8)>="28"&&c.date>r.date&&c.date<=monthEnd(r.date)));
/** Which stored rows a source row may be declared a duplicate of. File uploads keep exact matching only. */
const linkable=(origin:string)=>(r:PreviewRow,c:Candidate)=>matches(r,c)||(origin==="sync"&&near(r,c));
// A bank row equal in date, description and signed amount on the same account is the
// same bank transaction. Expense and credit rows only suggest a match, so they ask — and so does a near one.
const initialResolution=(kind:string,exact:boolean,close=false)=>exact?(kind==="bank"?"duplicate":"review"):close?"review":"include";

export interface ResolutionCounts { included:number; duplicate:number; pending:number }
const tally=(rows:{resolution:string}[]):ResolutionCounts=>{
  const counts={included:0,duplicate:0,pending:0};
  for(const row of rows) {
    if(row.resolution==="include") counts.included++;
    else if(row.resolution==="duplicate") counts.duplicate++;
    else counts.pending++;
  }
  return counts;
};

export const importRows = {
  async replace(userId:number,sessionId:string,kind:string,answers:{accountId?:number;cardId?:number;month?:string},rows:PreviewRow[],origin:string="file") {
    const candidates=await candidatesFor(userId,kind,answers);
    const consumed=new Set<string>();
    const claim=(normalized:PreviewRow,test:(r:PreviewRow,c:Candidate)=>boolean)=>{
      // One existing occurrence suggests one duplicate; repeated source rows remain distinct.
      const match=candidates.find(c=>!consumed.has(`${c.kind}:${c.id}`)&&test(normalized,c));
      if(match) consumed.add(`${match.kind}:${match.id}`);
      return match;
    };
    const normalized=rows.map(original=>({...original,date:original.date??(answers.month?`${answers.month}-01`:null)}));
    // Every exact match claims its stored row before any near one may: otherwise a reworded row
    // earlier in the file could take the row that the exact copy, later on, really is.
    const exact=normalized.map(row=>claim(row,matches));
    const close=normalized.map((row,i)=>exact[i]||origin!=="sync"?undefined:claim(row,near));
    await prisma.importRow.deleteMany({where:{sessionId}});
    for(let i=0;i<rows.length;i++) {
      const selected=exact[i]??close[i];
      const resolution=initialResolution(kind,!!exact[i],!!close[i]);
      await prisma.importRow.create({data:{sessionId,rowNumber:i+1,original:json(rows[i]),normalized:json(normalized[i]),candidates:json(selected?[selected]:[]),resolution,matchRef:resolution==="duplicate"?json(selected):undefined}});
    }
    return fingerprint(candidates);
  },
  async list(userId:number,sessionId:string,page=1,filter?:"review") {
    const session=await prisma.importSession.findFirst({where:{id:sessionId,userId}});
    if(!session) throw ApiError.notFound("הייבוא לא נמצא");
    const [items,decisions]=await Promise.all([
      prisma.importRow.findMany({where:{sessionId,...(filter?{resolution:filter}:{})},orderBy:{rowNumber:"asc"},skip:(page-1)*50,take:50}),
      prisma.importRow.findMany({where:{sessionId},select:{original:true,normalized:true,resolution:true,candidates:true}}),
    ]);
    const counts=tally(decisions);
    let editedCount=0;
    const answers=session.answers as {month?:string};
    for(const row of decisions) {
      const original=row.original as unknown as PreviewRow;
      const initial={...original,date:original.date??(answers.month?`${answers.month}-01`:null)};
      const first=Array.isArray(row.candidates)?(row.candidates as unknown as Candidate[])[0]:undefined;
      const exact=!!first&&matches(initial,first);
      if(row.resolution!==initialResolution(session.kind,exact,!!first&&!exact)||!isDeepStrictEqual(initial,row.normalized)) editedCount++;
    }
    return {items,total:filter?counts.pending:decisions.length,page,pageSize:50,pendingCount:counts.pending,counts,editedCount};
  },
  /** The import screen's own counts and status, for screens that only point at a session (the sync summary). */
  async summaries(userId:number,sessionIds:string[]) {
    if(!sessionIds.length) return new Map<string,{status:string;counts:ResolutionCounts}>();
    const [sessions,rows]=await Promise.all([
      prisma.importSession.findMany({where:{userId,id:{in:sessionIds}},select:{id:true,status:true}}),
      prisma.importRow.findMany({where:{sessionId:{in:sessionIds},session:{userId}},select:{sessionId:true,resolution:true}}),
    ]);
    return new Map(sessions.map(s=>[s.id,{status:s.status,counts:tally(rows.filter(r=>r.sessionId===s.id))}]));
  },
  async edit(userId:number,sessionId:string,rowNumber:number,input:unknown) {
    const body=rowEditSchema.parse(input);
    const session=await prisma.importSession.findFirst({where:{id:sessionId,userId}});
    if(!session) throw ApiError.notFound("הייבוא לא נמצא");
    if(session.version!==body.version||!["ready_for_review","needs_input"].includes(session.status)) throw ApiError.conflict("הייבוא השתנה או כבר הוסיף תנועות — יש לרענן");
    const row=await prisma.importRow.findUnique({where:{sessionId_rowNumber:{sessionId,rowNumber}}});
    if(!row) throw ApiError.notFound("השורה לא נמצאה");
    const current=row.normalized as unknown as PreviewRow;
    const normalized=body.normalized??current;
    if(["bank","loan_schedule"].includes(session.kind)&&fingerprint(normalized)!==fingerprint(current)) throw ApiError.badRequest("סכומי דוח בנק ולוח סילוקין מאומתים מול המקור. לתיקון יש להעלות קובץ מתוקן; ניתן לבדוק כפילויות כאן");
    if(session.kind==="expense_sheet"&&normalized.amount<=0) throw ApiError.badRequest("סכום הוצאה חייב להיות חיובי");
    if(!normalized.date) throw ApiError.badRequest("יש להשלים תאריך או חודש לפני אישור השורה");
    const allCandidates=await candidatesFor(userId,session.kind,session.answers as {accountId?:number;cardId?:number});
    if((session.preview as {sourceVersion?:string}|null)?.sourceVersion!==fingerprint(allCandidates)) throw ApiError.conflict("התנועות הקיימות השתנו. יש להפעיל בדיקת פרטים מחדש לפני עריכת השורות");
    const candidates=allCandidates.filter(c=>linkable(session.origin)(normalized,c));
    const matched=body.resolution==="duplicate"?candidates.find(c=>c.id===body.candidateId&&c.kind===body.candidateKind):undefined;
    if(body.resolution==="duplicate"&&!matched) throw ApiError.conflict("התנועה המקושרת אינה תואמת עוד. יש לבדוק מחדש");
    if(matched) {
      const allocated=await prisma.importRow.findMany({where:{sessionId,resolution:"duplicate",id:{not:row.id}}});
      if(allocated.some(r=>{const ref=r.matchRef as unknown as SourceRef|null;return ref?.kind===matched.kind&&ref.id===matched.id;})) throw ApiError.conflict("התנועה הזו כבר משויכת לשורת מקור אחרת");
    }
    await prisma.importRow.update({where:{id:row.id},data:{normalized:json(normalized),candidates:json(candidates),resolution:body.resolution,matchRef:matched?json(matched):undefined}});
    await prisma.importSession.update({where:{id:sessionId},data:{version:{increment:1}}});
    return prisma.importSession.findUniqueOrThrow({where:{id:sessionId}});
  },
  async validate(userId:number,sessionId:string,kind:string,answers:{accountId?:number;cardId?:number},origin:string="file") {
    const rows=await prisma.importRow.findMany({where:{sessionId},orderBy:{rowNumber:"asc"}});
    if(rows.some(r=>r.resolution==="review")) throw ApiError.conflict("יש להחליט על התנועות שנראות כפולות לפני ההוספה");
    const candidates=await candidatesFor(userId,kind,answers);
    const session=await prisma.importSession.findUniqueOrThrow({where:{id:sessionId}});
    if((session.preview as {sourceVersion?:string}|null)?.sourceVersion!==fingerprint(candidates)) throw ApiError.conflict("התנועות הקיימות השתנו מאז התצוגה המקדימה. יש להפעיל בדיקת פרטים מחדש");
    for(const row of rows) {
      if(row.resolution!=="duplicate") continue;
      const ref=row.matchRef as unknown as SourceRef;
      if(!candidates.some(c=>c.kind===ref.kind&&c.id===ref.id&&c.fingerprint===ref.fingerprint&&linkable(origin)(row.normalized as unknown as PreviewRow,c))) throw ApiError.conflict("מקור ששימש להחלטת כפילות השתנה או נמחק. יש לבדוק שוב את השורה");
    }
    return rows;
  },
};
