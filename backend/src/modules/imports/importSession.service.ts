import { readFile } from "node:fs/promises";
import { z } from "zod";
import { prisma, withFinancialTransaction } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { documentStorage } from "../documents/documentStorage.service";
import { documentsService } from "../documents/documents.service";
import { bankService } from "../bank/bank.service";
import { parseBankStatement, parseBankStatementPdf } from "../bank/bankParser.service";
import { creditService } from "../credit/credit.service";
import { parseCreditFile } from "../credit/creditParser.service";
import { loanScheduleService } from "../loans/loanSchedule.service";
import { parseLoanSchedule } from "../loans/loanSchedule.parser";
import { importsService } from "./imports.service";
import { parseExpensesFile } from "./importsParser.service";
import { detectStatement, hashFile } from "./statementDetector.service";
import { json } from "../journey/journey.utils";

export const answersSchema = z.object({
  kind: z.enum(["bank", "credit", "loan_schedule", "expense_sheet"]).optional(),
  accountId: z.number().int().positive().optional(), cardId: z.number().int().positive().optional(),
  loanId: z.number().int().positive().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
}).strict();
type Answers = z.infer<typeof answersSchema>;
interface PreviewRow { date: string | null; name: string; amount: number }
export interface ImportPreview { rows: PreviewRow[]; total: number; count: number; warnings: string[]; questions: string[]; previousImportId?: number }
async function owned(userId: number, id: string) {
  const session = await prisma.importSession.findFirst({ where: { id, userId } });
  if (!session) throw ApiError.notFound("הקליטה לא נמצאה");
  return session;
}
async function bytes(storagePath: string) {
  const path = documentStorage.resolve(storagePath);
  if (!path) throw ApiError.badRequest("הקובץ אינו זמין — יש להעלות אותו מחדש");
  try { return await readFile(path); } catch { throw ApiError.badRequest("הקובץ אינו זמין — יש לבטל את הקליטה ולהעלות אותו מחדש"); }
}
async function prepare(userId: number, buffer: Buffer, fileName: string, answers: Answers) {
  const detected = detectStatement(buffer, fileName);
  // A PDF extension alone is not evidence of its financial meaning.
  let kind: string = answers.kind ?? (/\.pdf$/i.test(fileName) ? "unknown" : detected.kind);
  if (kind === "unknown" && !/\.pdf$/i.test(fileName)) {
    try { if (parseExpensesFile(buffer).length) kind = "expense_sheet"; } catch { /* Ask, do not import. */ }
  }
  const preview: ImportPreview = { rows: [], total: 0, count: 0, warnings: [], questions: [] };
  if (kind === "unknown") { preview.questions.push("יש לבחור את סוג הקובץ. PDF נתמך כאן כדף חשבון בנק בלבד."); return { kind, preview }; }
  if (kind === "bank") {
    const parsed = /\.pdf$/i.test(fileName) || buffer.subarray(0,5).toString() === "%PDF-" ? await parseBankStatementPdf(buffer) : parseBankStatement(buffer);
    preview.rows = parsed.rows.map(r=>({ date: r.date.toISOString().slice(0,10), name:r.description, amount:r.type === "deposit" ? r.amount : -r.amount }));
    if (!answers.accountId || !await prisma.bankAccount.findFirst({where:{id:answers.accountId,userId}})) preview.questions.push("יש לבחור או ליצור חשבון בנק שאליו שייך הדוח");
    if (parsed.report.rejected.length || parsed.report.balanceMismatches.length) preview.questions.push("יש בקובץ שורות שנדחו או אי־התאמת יתרה. יש לתקן את קובץ המקור ולהעלות מחדש לפני קליטה.");
    for (const issue of [...parsed.report.rejected, ...parsed.report.review]) preview.warnings.push(`${issue.line}: ${issue.reason}`);
    for (const mismatch of parsed.report.balanceMismatches) preview.warnings.push(`אי־התאמת יתרה בתאריך ${mismatch.date}: פער ${mismatch.diff}`);
    preview.warnings.push("היתרה תחושב מהדוח. תנועות זהות שכבר קיימות בחשבון ידולגו לפי מספר המופעים; גם דוח חופף עשוי לעדכן את יתרת הבנק.");
  } else if (kind === "credit") {
    const rows = parseCreditFile(buffer);
    preview.rows = rows.map(r=>({ date:r.transactionDate.toISOString().slice(0,10), name:r.businessName, amount:r.amount }));
    if (!answers.cardId || !await prisma.creditCard.findFirst({where:{id:answers.cardId,userId}})) preview.questions.push("יש לבחור או ליצור את כרטיס האשראי שאליו שייך הדוח");
    if (rows.some(r=>!r.chargeDate)) preview.warnings.push("לחלק מהעסקאות אין מועד חיוב. הן לא מוכיחות מה יהיה חיוב הכרטיס הבא.");
    const previous = await prisma.creditImport.findFirst({where:{userId,fileHash:hashFile(buffer)}});
    if (previous) { preview.previousImportId=previous.id; preview.warnings.push("הקובץ כבר נקלט. לא ייווצרו עסקאות נוספות; נפתח את הדוח הקיים לבדיקה."); }
    preview.warnings.push("סכומי אשראי נכנסים לסיכום החודש רק לאחר אישור הדוח. התאמות לתנועות בנק יתעדכנו בהתאם.");
  } else if (kind === "loan_schedule") {
    const parsed = parseLoanSchedule(buffer);
    preview.rows = parsed.rows.map(r=>({date:r.paymentDate,name:`תשלום ${r.paymentNumber}`,amount:r.total}));
    if (answers.loanId && !await prisma.loan.findFirst({where:{id:answers.loanId,userId}})) preview.questions.push("ההלוואה שנבחרה אינה זמינה");
    if (!answers.loanId && !parsed.loanNumber) preview.questions.push("אין מספר הלוואה בקובץ — יש לבחור את ההלוואה שאליה הוא שייך");
    if (parsed.originalAmountSource === "reconstructed") preview.warnings.push("הסכום המקורי משוחזר ואינו נתון מאומת מהחוזה");
    preview.warnings.push("לוח זה ייצור הלוואה או יעדכן את לוח התשלומים הקיים; הוא אינו תנועת בנק.");
  } else {
    const rows = parseExpensesFile(buffer);
    preview.rows = rows.map(r=>({date:r.date?.toISOString().slice(0,10) ?? null,name:r.name,amount:r.amount}));
    if (rows.some(r=>!r.date) && !answers.month) preview.questions.push("יש לבחור חודש עבור שורות ללא תאריך; הן יירשמו ליום הראשון בחודש");
    preview.warnings.push("שורות זהות שכבר רשומות כהוצאות ידולגו לפי מספר המופעים. יש לוודא שהגיליון אינו משכפל רכישות שכבר נקלטו מדוח אשראי.");
  }
  preview.count=preview.rows.length;
  preview.total=Math.round(preview.rows.reduce((sum,r)=>sum+r.amount,0)*100)/100;
  if (!preview.count) preview.questions.push("לא נמצאו שורות לקליטה — יש לבדוק את קובץ המקור");
  if (preview.count > 10000) throw ApiError.badRequest("הקובץ מכיל יותר מ־10,000 שורות. יש לפצל אותו.");
  return {kind,preview};
}
export const importSessions = {
  async list(userId:number) { return prisma.importSession.findMany({where:{userId},orderBy:{createdAt:"desc"},take:50,select:{id:true,fileName:true,kind:true,status:true,updatedAt:true}}); },
  get: owned,
  async create(userId:number,fileName:string,buffer:Buffer,input:unknown) {
    const answers=answersSchema.parse(input);
    const fileHash=hashFile(buffer);
    const storagePath=await documentStorage.save(userId,fileHash,fileName,buffer);
    if (!storagePath) throw ApiError.internal("לא ניתן לשמור את הקובץ להמשך. לא נקלטו נתונים; אפשר לנסות שוב.");
    const prepared=await prepare(userId,buffer,fileName,answers);
    return withFinancialTransaction(userId,async()=>{
      const previous=await prisma.importSession.findFirst({where:{userId,fileHash,status:{not:"cancelled"}},orderBy:{createdAt:"desc"}});
      if(previous) return previous;
      return prisma.importSession.create({data:{userId,fileName,fileHash,storagePath,kind:prepared.kind,answers:json(answers),preview:json(prepared.preview),status:prepared.preview.questions.length?"needs_input":"ready_for_review"}});
    });
  },
  async answer(userId:number,id:string,version:number,input:unknown) {
    const current=await owned(userId,id);
    if(!["needs_input","ready_for_review"].includes(current.status)) throw ApiError.conflict("הקליטה כבר הוחלה או בוטלה");
    const answers=answersSchema.parse({...current.answers as object,...answersSchema.parse(input)});
    const prepared=await prepare(userId,await bytes(current.storagePath),current.fileName,answers);
    const changed=await prisma.importSession.updateMany({where:{id,userId,version,status:{in:["needs_input","ready_for_review"]}},data:{answers:json(answers),preview:json(prepared.preview),kind:prepared.kind,status:prepared.preview.questions.length?"needs_input":"ready_for_review",version:{increment:1}}});
    if(!changed.count) throw ApiError.conflict("הקליטה השתנתה בחלון אחר. יש לרענן.");
    return owned(userId,id);
  },
  async commit(userId:number,id:string,version:number) {
    const initial=await owned(userId,id);
    const buffer=await bytes(initial.storagePath);
    return withFinancialTransaction(userId,async()=>{
      const session=await owned(userId,id);
      if(["completed","review"].includes(session.status)) return session;
      if(session.version!==version || session.status!=="ready_for_review") throw ApiError.conflict("יש להשלים את השאלות ולבדוק את הגרסה העדכנית לפני קליטה");
      const answers=answersSchema.parse(session.answers);
      const check=await prepare(userId,buffer,session.fileName,answers);
      if(check.preview.questions.length) throw ApiError.conflict(check.preview.questions.join(" · "));
      await prisma.importSession.update({where:{id},data:{status:"committing"}});
      let result: unknown;
      let creditImportId: number | undefined;
      let statementImportId: number | undefined;
      const beforeExpenses=session.kind==="expense_sheet" ? await prisma.expense.findMany({where:{userId},select:{id:true}}) : [];
      if(session.kind==="bank") {
        const imported=await bankService.importStatement(userId,answers.accountId!,buffer,session.fileName);
        result=imported; statementImportId=imported.statementImportId;
      } else if(session.kind==="credit") {
        const imported=await creditService.createImport(userId,session.fileName,buffer,{cardId:answers.cardId});
        creditImportId=imported.alreadyImported?imported.previousImport?.id:imported.id;
        result=imported;
      } else if(session.kind==="loan_schedule") {
        result=await loanScheduleService.importSchedule(userId,buffer,answers.loanId);
      } else {
        const month=answers.month ?? check.preview.rows.find(r=>r.date)?.date?.slice(0,7);
        if(!month) throw ApiError.badRequest("נדרש חודש לקליטה");
        const [year,m]=month.split("-").map(Number);
        const imported=await importsService.importExpenses(userId,buffer,year,m);
        const oldIds=new Set(beforeExpenses.map(r=>r.id));
        const expenseIds=(await prisma.expense.findMany({where:{userId},select:{id:true}})).filter(r=>!oldIds.has(r.id)).map(r=>r.id);
        result={...imported,expenseIds};
      }
      const dates=check.preview.rows.flatMap(r=>r.date?[r.date]:[]).sort();
      // Required provenance is in the session transaction. Document log remains compatible.
      if(session.kind!=="loan_schedule") await documentsService.record(userId,{fileName:session.fileName,fileHash:session.fileHash,sizeBytes:buffer.length,buffer,
        kind:session.kind==="bank"?"bank_statement":session.kind==="credit"?"credit_report":"expense_sheet",
        linkedAccountId:answers.accountId,linkedCreditImportId:creditImportId,linkedStatementImportId:statementImportId,
        coverageFrom:dates.length?new Date(dates[0]):null,coverageTo:dates.length?new Date(dates[dates.length-1]):null,
        rowsParsed:check.preview.count,note:"נקלט בתהליך בדיקה מתמשך"});
      return prisma.importSession.update({where:{id},data:{status:"review",result:json({details:result,creditImportId,statementImportId,accountId:answers.accountId}),version:{increment:1}}});
    });
  },
  async finish(userId:number,id:string) {
    return withFinancialTransaction(userId,async()=>{
      const session=await owned(userId,id);
      if(session.status==="completed") return session;
      if(session.status!=="review") throw ApiError.conflict("יש לקלוט ולבדוק את הנתונים לפני השלמת התהליך");
      const result=session.result as {creditImportId?:number;statementImportId?:number};
      if(result.creditImportId) {
        const credit=await prisma.creditImport.findFirst({where:{id:result.creditImportId,userId}});
        if(!credit || credit.status!=="confirmed") throw ApiError.conflict("יש לאשר את דוח האשראי לפני סיום הבדיקה");
      }
      if(result.statementImportId && await prisma.bankTransaction.count({where:{userId,statementImportId:result.statementImportId,resolution:null}})) throw ApiError.conflict("נותרו תנועות בנק ללא משמעות כספית. יש להשלים התאמה.");
      return prisma.importSession.update({where:{id},data:{status:"completed",version:{increment:1}}});
    });
  },
  async cancel(userId:number,id:string) {
    const changed=await prisma.importSession.updateMany({where:{id,userId,status:{in:["needs_input","ready_for_review"]}},data:{status:"cancelled",version:{increment:1}}});
    if(!changed.count) throw ApiError.conflict("לא ניתן לבטל קליטה שכבר הוחלה. ביטול נתונים מתבצע דרך המסמך המקורי.");
    return owned(userId,id);
  },
};
