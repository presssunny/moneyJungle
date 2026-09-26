import { z } from "zod";
import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { fingerprint, json } from "../journey/journey.utils";

export interface PreviewRow { date: string | null; name: string; amount: number; chargeDate?: string | null; installment?: number | null }
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
const matches=(r:PreviewRow,c:Candidate)=>r.date===c.date&&r.name.trim()===c.name.trim()&&Math.round(r.amount*100)===Math.round(c.amount*100)
  &&!(r.installment!=null&&c.installment!=null&&r.installment!==c.installment);

export const importRows = {
  async replace(userId:number,sessionId:string,kind:string,answers:{accountId?:number;cardId?:number;month?:string},rows:PreviewRow[]) {
    const candidates=await candidatesFor(userId,kind,answers);
    const consumed=new Set<string>();
    await prisma.importRow.deleteMany({where:{sessionId}});
    for(let i=0;i<rows.length;i++) {
      const original=rows[i];
      const normalized={...original,date:original.date??(answers.month?`${answers.month}-01`:null)};
      const found=candidates.filter(c=>!consumed.has(`${c.kind}:${c.id}`)&&matches(normalized,c));
      // One existing occurrence suggests one duplicate; repeated source rows remain distinct.
      const selected=found.slice(0,1);
      for(const c of selected) consumed.add(`${c.kind}:${c.id}`);
      await prisma.importRow.create({data:{sessionId,rowNumber:i+1,original:json(original),normalized:json(normalized),candidates:json(selected),resolution:selected.length?"review":"include"}});
    }
    return fingerprint(candidates);
  },
  async list(userId:number,sessionId:string,page=1) {
    if(!await prisma.importSession.findFirst({where:{id:sessionId,userId}})) throw ApiError.notFound("הקליטה לא נמצאה");
    const [items,total]=await Promise.all([prisma.importRow.findMany({where:{sessionId},orderBy:{rowNumber:"asc"},skip:(page-1)*50,take:50}),prisma.importRow.count({where:{sessionId}})]);
    return {items,total,page,pageSize:50,pendingCount:await prisma.importRow.count({where:{sessionId,resolution:"review"}})};
  },
  async edit(userId:number,sessionId:string,rowNumber:number,input:unknown) {
    const body=rowEditSchema.parse(input);
    const session=await prisma.importSession.findFirst({where:{id:sessionId,userId}});
    if(!session||session.version!==body.version||!["ready_for_review","needs_input"].includes(session.status)) throw ApiError.conflict("הקליטה השתנתה או כבר הוחלה. יש לרענן");
    const row=await prisma.importRow.findUnique({where:{sessionId_rowNumber:{sessionId,rowNumber}}});
    if(!row) throw ApiError.notFound("השורה לא נמצאה");
    const current=row.normalized as unknown as PreviewRow;
    const normalized=body.normalized??current;
    if(["bank","loan_schedule"].includes(session.kind)&&fingerprint(normalized)!==fingerprint(current)) throw ApiError.badRequest("סכומי דוח בנק ולוח סילוקין מאומתים מול המקור. לתיקון יש להעלות קובץ מתוקן; ניתן לבדוק כפילויות כאן");
    if(session.kind==="expense_sheet"&&normalized.amount<=0) throw ApiError.badRequest("סכום הוצאה חייב להיות חיובי");
    if(!normalized.date) throw ApiError.badRequest("יש להשלים תאריך או חודש לפני אישור השורה");
    const allCandidates=await candidatesFor(userId,session.kind,session.answers as {accountId?:number;cardId?:number});
    if((session.preview as {sourceVersion?:string}|null)?.sourceVersion!==fingerprint(allCandidates)) throw ApiError.conflict("התנועות הקיימות השתנו. יש להפעיל בדיקת פרטים מחדש לפני עריכת השורות");
    const candidates=allCandidates.filter(c=>matches(normalized,c));
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
  async validate(userId:number,sessionId:string,kind:string,answers:{accountId?:number;cardId?:number}) {
    const rows=await prisma.importRow.findMany({where:{sessionId},orderBy:{rowNumber:"asc"}});
    if(rows.some(r=>r.resolution==="review")) throw ApiError.conflict("יש לבדוק את הכפילויות החשודות לפני קליטה");
    const candidates=await candidatesFor(userId,kind,answers);
    const session=await prisma.importSession.findUniqueOrThrow({where:{id:sessionId}});
    if((session.preview as {sourceVersion?:string}|null)?.sourceVersion!==fingerprint(candidates)) throw ApiError.conflict("התנועות הקיימות השתנו מאז התצוגה המקדימה. יש להפעיל בדיקת פרטים מחדש");
    for(const row of rows) {
      if(row.resolution!=="duplicate") continue;
      const ref=row.matchRef as unknown as SourceRef;
      if(!candidates.some(c=>c.kind===ref.kind&&c.id===ref.id&&c.fingerprint===ref.fingerprint&&matches(row.normalized as unknown as PreviewRow,c))) throw ApiError.conflict("מקור ששימש להחלטת כפילות השתנה או נמחק. יש לבדוק שוב את השורה");
    }
    return rows;
  },
};
