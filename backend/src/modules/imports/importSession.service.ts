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
import { importRows, type PreviewRow, type SourceRef } from "./importRows.service";
import { json } from "../journey/journey.utils";

export const answersSchema = z.object({
  kind: z.enum(["bank", "credit", "loan_schedule", "expense_sheet"]).optional(),
  accountId: z.number().int().positive().optional(), cardId: z.number().int().positive().optional(),
  loanId: z.number().int().positive().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
}).strict();
type Answers = z.infer<typeof answersSchema>;
export interface ImportPreview { rows: PreviewRow[]; total: number; count: number; warnings: string[]; questions: string[]; previousImportId?: number }
async function owned(userId: number, id: string) {
  const session = await prisma.importSession.findFirst({ where: { id, userId } });
  if (!session) throw ApiError.notFound("הייבוא לא נמצא");
  return session;
}
async function bytes(storagePath: string) {
  const path = documentStorage.resolve(storagePath);
  if (!path) throw ApiError.badRequest("הקובץ אינו זמין — יש להעלות אותו מחדש");
  try { return await readFile(path); } catch { throw ApiError.badRequest("הקובץ אינו זמין — יש לבטל את הייבוא ולהעלות אותו מחדש"); }
}
async function prepare(userId: number, buffer: Buffer, fileName: string, answers: Answers) {
  const detected = detectStatement(buffer, fileName);
  // A PDF extension alone is not evidence of its financial meaning.
  let kind: string = answers.kind ?? (/\.pdf$/i.test(fileName) ? "unknown" : detected.kind);
  if (kind === "unknown" && !/\.pdf$/i.test(fileName)) {
    try { if (parseExpensesFile(buffer).length) kind = "expense_sheet"; } catch { /* Ask, do not import. */ }
  }
  const preview: ImportPreview = { rows: [], total: 0, count: 0, warnings: [], questions: [] };
  if (kind === "unknown") { preview.questions.push("יש לבחור את סוג הדוח. קובץ PDF נתמך כאן רק כדף חשבון עו״ש."); return { kind, preview }; }
  if (kind === "bank") {
    const parsed = /\.pdf$/i.test(fileName) || buffer.subarray(0,5).toString() === "%PDF-" ? await parseBankStatementPdf(buffer) : parseBankStatement(buffer);
    preview.rows = parsed.rows.map(r=>({ date: r.date.toISOString().slice(0,10), name:r.description, amount:r.type === "deposit" ? r.amount : -r.amount }));
    if (!answers.accountId || !await prisma.bankAccount.findFirst({where:{id:answers.accountId,userId}})) preview.questions.push("יש לבחור את חשבון הבנק שאליו שייך הדף, או להוסיף אותו");
    if (parsed.report.rejected.length || parsed.report.balanceMismatches.length) preview.questions.push("בחלק מהשורות היתרה לא מתיישבת או שלא הצלחנו לקרוא אותן. כדאי להוריד את הדף מחדש מאתר הבנק ולהעלות שוב.");
    for (const issue of [...parsed.report.rejected, ...parsed.report.review]) preview.warnings.push(`${issue.line}: ${issue.reason}`);
    for (const mismatch of parsed.report.balanceMismatches) preview.warnings.push(`אי־התאמת יתרה בתאריך ${mismatch.date}: פער ${mismatch.diff}`);
    preview.warnings.push("היתרה בחשבון תחושב מהדף. תנועות שכבר קיימות לא יתווספו שוב, גם אם הדף חופף לדף קודם.");
  } else if (kind === "credit") {
    const rows = parseCreditFile(buffer);
    preview.rows = rows.map(r=>({ date:r.transactionDate.toISOString().slice(0,10), name:r.businessName, amount:r.amount, chargeDate:r.chargeDate?.toISOString().slice(0,10)??null, installment:r.installmentNumber }));
    if (!answers.cardId || !await prisma.creditCard.findFirst({where:{id:answers.cardId,userId}})) preview.questions.push("יש לבחור את כרטיס האשראי שאליו שייך הפירוט, או להוסיף אותו");
    if (rows.some(r=>!r.chargeDate)) preview.warnings.push("חלק מהעסקאות עדיין בקליטה אצל חברת הכרטיס ואין להן מועד חיוב. הן ייספרו בחודש הקנייה, אבל עוד לא בחיוב הבא.");
    const previous = await prisma.creditImport.findFirst({where:{userId,fileHash:hashFile(buffer)}});
    if (previous) { preview.previousImportId=previous.id; preview.warnings.push("הפירוט הזה כבר הועלה. לא יתווספו עסקאות כפולות; נפתח את הפירוט הקיים לבדיקה."); }
    preview.warnings.push("העסקאות בכרטיס ייכנסו להוצאות החודש רק אחרי שתאשרי את הפירוט. החיוב המרוכז בדף הבנק לא ייספר פעמיים.");
  } else if (kind === "loan_schedule") {
    const parsed = parseLoanSchedule(buffer);
    preview.rows = parsed.rows.map(r=>({date:r.paymentDate,name:`תשלום ${r.paymentNumber}`,amount:r.total}));
    if (answers.loanId && !await prisma.loan.findFirst({where:{id:answers.loanId,userId}})) preview.questions.push("ההלוואה שנבחרה אינה זמינה");
    if (!answers.loanId && !parsed.loanNumber) preview.questions.push("בלוח לא מופיע מספר הלוואה — יש לבחור לאיזו הלוואה הוא שייך");
    if (parsed.originalAmountSource === "reconstructed") preview.warnings.push("סכום ההלוואה המקורי חושב מהלוח ואינו לקוח מהחוזה");
    preview.warnings.push("הלוח ייצור את ההלוואה או יעדכן את לוח התשלומים שלה. הוא לא מוסיף תנועות לחשבון.");
  } else {
    const rows = parseExpensesFile(buffer);
    preview.rows = rows.map(r=>({date:r.date?.toISOString().slice(0,10) ?? null,name:r.name,amount:r.amount}));
    if (rows.some(r=>!r.date) && !answers.month) preview.questions.push("יש לבחור חודש לשורות בלי תאריך; הן יירשמו ב־1 לחודש");
    preview.warnings.push("הוצאות שכבר רשומות לא יתווספו שוב. כדאי לוודא שהרשימה לא כוללת קניות שכבר מופיעות בפירוט כרטיס האשראי.");
  }
  preview.count=preview.rows.length;
  preview.total=Math.round(preview.rows.reduce((sum,r)=>sum+r.amount,0)*100)/100;
  if (!preview.count) preview.questions.push("לא מצאנו תנועות בקובץ — כדאי לבדוק שזה הקובץ הנכון");
  if (preview.count > 10000) throw ApiError.badRequest("בקובץ יותר מ־10,000 שורות. יש לפצל אותו לכמה קבצים.");
  return {kind,preview};
}
async function processSession(userId:number,id:string,answers:Answers) {
  const session=await owned(userId,id);
  await prisma.importSession.update({where:{id},data:{status:"processing",answers:json(answers),error:null}});
  try {
    const prepared=await prepare(userId,await bytes(session.storagePath),session.fileName,answers);
    const sourceVersion=await importRows.replace(userId,id,prepared.kind,answers,prepared.preview.rows);
    return prisma.importSession.update({where:{id},data:{kind:prepared.kind,preview:json({...prepared.preview,sourceVersion,rows:prepared.preview.rows.slice(0,50)}),status:prepared.preview.questions.length?"needs_input":"ready_for_review",version:{increment:1}}});
  } catch(error) {
    return prisma.importSession.update({where:{id},data:{status:"failed",error:(error instanceof Error?error.message:"עיבוד הקובץ נכשל").slice(0,500),version:{increment:1}}});
  }
}

export const importSessions = {
  async list(userId:number) { return prisma.importSession.findMany({where:{userId},orderBy:{createdAt:"desc"},take:50,select:{id:true,fileName:true,kind:true,status:true,updatedAt:true}}); },
  get: owned,
  async create(userId:number,fileName:string,buffer:Buffer,input:unknown) {
    const answers=answersSchema.parse(input);
    const fileHash=hashFile(buffer);
    const session=await withFinancialTransaction(userId,async()=>{
      const previous=await prisma.importSession.findFirst({where:{userId,fileHash,status:{notIn:["cancelled","rolled_back"]}},orderBy:{createdAt:"desc"}});
      if(previous) return previous;
      const storagePath=await documentStorage.save(userId,fileHash,fileName,buffer);
      if(!storagePath) throw ApiError.internal("לא הצלחנו לשמור את הקובץ. לא נוסף דבר; אפשר לנסות שוב.");
      return prisma.importSession.create({data:{userId,fileName,fileHash,storagePath,answers:json(answers),status:"uploaded"}});
    });
    return session.status==="uploaded"?withFinancialTransaction(userId,async()=>{const current=await owned(userId,session.id);return current.status==="uploaded"?processSession(userId,session.id,answers):current;}):session;
  },
  async answer(userId:number,id:string,version:number,input:unknown) {
    return withFinancialTransaction(userId,async()=>{
      const current=await owned(userId,id);
      if(current.version!==version||!["uploaded","processing","failed","needs_input","ready_for_review"].includes(current.status)) throw ApiError.conflict("הייבוא השתנה או כבר הוסיף תנועות — יש לרענן");
      const answers=answersSchema.parse({...current.answers as object,...answersSchema.parse(input)});
      return processSession(userId,id,answers);
    });
  },
  async commit(userId:number,id:string,version:number) {
    return withFinancialTransaction(userId,async()=>{
      const session=await owned(userId,id);
      if(["completed","review"].includes(session.status)) {
        const prior=session.result as {commitVersion?:number}|null;
        if(prior?.commitVersion!==undefined&&![prior.commitVersion,session.version].includes(version)) throw ApiError.conflict("הייבוא השתנה בינתיים — יש לרענן");
        return session;
      }
      if(session.version!==version || session.status!=="ready_for_review") throw ApiError.conflict("יש להשלים את הפרטים ולרענן לפני ההוספה");
      const buffer=await bytes(session.storagePath);
      const answers=answersSchema.parse(session.answers);
      const check=await prepare(userId,buffer,session.fileName,answers);
      if(check.preview.questions.length) throw ApiError.conflict(check.preview.questions.join(" · "));
      if(!await prisma.importRow.count({where:{sessionId:id}})) {
        const sourceVersion=await importRows.replace(userId,id,session.kind,answers,check.preview.rows);
        await prisma.importSession.update({where:{id},data:{preview:json({...check.preview,sourceVersion,rows:check.preview.rows.slice(0,50)})}});
      }
      const staged=await importRows.validate(userId,id,session.kind,answers);
      const included=staged.filter(r=>r.resolution==="include");
      await prisma.importSession.update({where:{id},data:{status:"committing"}});
      let result: unknown;
      let creditImportId: number | undefined;
      let statementImportId: number | undefined;
      let loanId:number|undefined;
      let expenseIds:number[]=[];
      if(session.kind==="bank") {
        const imported=await bankService.importStatement(userId,answers.accountId!,buffer,session.fileName,included.map(r=>r.rowNumber));
        result=imported; statementImportId=imported.statementImportId;
      } else if(session.kind==="credit") {
        const parsed=parseCreditFile(buffer);
        const imported=await creditService.createImport(userId,session.fileName,buffer,{cardId:answers.cardId,staged:included.map(row=>{
          const normalized=row.normalized as unknown as PreviewRow;
          return {...parsed[row.rowNumber-1],transactionDate:new Date(normalized.date!),businessName:normalized.name,amount:normalized.amount,chargeDate:normalized.chargeDate?new Date(normalized.chargeDate):null};
        })});
        creditImportId=imported.alreadyImported?imported.previousImport?.id:imported.id;
        result=imported;
      } else if(session.kind==="loan_schedule") {
        const imported=await loanScheduleService.importSchedule(userId,buffer,answers.loanId,true);
        loanId=imported.loanId;result=imported;
      } else {
        const month=answers.month ?? check.preview.rows.find(r=>r.date)?.date?.slice(0,7);
        if(!month) throw ApiError.badRequest("יש לבחור חודש");
        const [year,m]=month.split("-").map(Number);
        const parsed=parseExpensesFile(buffer);
        const imported=await importsService.importExpenses(userId,buffer,year,m,included.map(row=>{
          const normalized=row.normalized as unknown as PreviewRow;
          return {...parsed[row.rowNumber-1],date:new Date(normalized.date!),name:normalized.name,amount:normalized.amount};
        }));
        expenseIds=imported.expenseIds;
        result={...imported,expenseIds};
      }
      const dates=staged.flatMap(r=>{const value=r.normalized as unknown as PreviewRow;return value.date?[value.date]:[];}).sort();
      // Required provenance is in the session transaction. Document log remains compatible.
      const documentId=await documentsService.record(userId,{required:true,fileName:session.fileName,fileHash:session.fileHash,sizeBytes:buffer.length,buffer,
        kind:session.kind==="bank"?"bank_statement":session.kind==="credit"?"credit_report":session.kind==="loan_schedule"?"loan_schedule":"expense_sheet",linkedLoanId:loanId,
        linkedAccountId:answers.accountId,linkedCreditImportId:creditImportId,linkedStatementImportId:statementImportId,
        coverageFrom:dates.length?new Date(dates[0]):null,coverageTo:dates.length?new Date(dates[dates.length-1]):null,
        rowsParsed:check.preview.count,rowsImported:included.length,rowsSkipped:staged.length-included.length,note:"נוסף ועדיין בבדיקה"});
      const outputs: Array<{kind:SourceRef["kind"];id:number;name:string;amount:number;date:string}>=[];
      if(statementImportId) for(const row of await prisma.bankTransaction.findMany({where:{userId,statementImportId},orderBy:{id:"asc"}})) outputs.push({kind:"bank",id:row.id,name:row.description??"",amount:Number(row.amount)*(row.type==="deposit"?1:-1),date:row.transactionDate.toISOString().slice(0,10)});
      if(creditImportId) for(const row of await prisma.creditTransaction.findMany({where:{userId,creditImportId},orderBy:{id:"asc"}})) outputs.push({kind:"credit",id:row.id,name:row.businessName,amount:Number(row.amount),date:row.transactionDate.toISOString().slice(0,10)});
      if(loanId) for(const row of await prisma.loanScheduleEntry.findMany({where:{loanId},orderBy:{paymentNumber:"asc"}})) outputs.push({kind:"loan_schedule",id:row.id,name:`תשלום ${row.paymentNumber}`,amount:Number(row.total),date:row.paymentDate.toISOString().slice(0,10)});
      for(const [index,row] of included.entries()) {
        const normalized=row.normalized as unknown as PreviewRow;
        const outputIndex=outputs.findIndex(o=>o.name===normalized.name&&o.date===normalized.date&&o.amount===normalized.amount);
        const output=session.kind==="expense_sheet"?{kind:"expense",id:expenseIds[index]}:outputIndex>=0?outputs.splice(outputIndex,1)[0]:null;
        if(!output) throw ApiError.internal("לא הצלחנו לקשר תנועה לשורה בקובץ. שום דבר לא נוסף.");
        await prisma.importRow.update({where:{id:row.id},data:{outputRef:json(output)}});
        // Reverse lineage: only for rows this commit actually created, never for
        // a matched duplicate — that target keeps pointing at its real origin.
        if(output.kind==="expense") await prisma.expense.update({where:{id:output.id},data:{importRowId:row.id}});
        else if(output.kind==="bank") await prisma.bankTransaction.update({where:{id:output.id},data:{importRowId:row.id}});
        else if(output.kind==="credit") await prisma.creditTransaction.update({where:{id:output.id},data:{importRowId:row.id}});
      }
      for(const row of staged.filter(r=>r.resolution==="duplicate")) await prisma.importRow.update({where:{id:row.id},data:{outputRef:json(row.matchRef)}});
      return prisma.importSession.update({where:{id},data:{status:"review",result:json({commitVersion:version,details:result,documentId,loanId,creditImportId,statementImportId,accountId:answers.accountId}),version:{increment:1}}});
    });
  },
  async finish(userId:number,id:string) {
    return withFinancialTransaction(userId,async()=>{
      const session=await owned(userId,id);
      if(!["completed","review"].includes(session.status)) throw ApiError.conflict("יש להוסיף ולבדוק את התנועות לפני הסיוםך");
      const result=session.result as {creditImportId?:number;statementImportId?:number;loanId?:number;documentId?:number};
      if(result.documentId&&!await prisma.document.findFirst({where:{id:result.documentId,userId,status:"imported"}})) throw ApiError.conflict("מסמך המקור בוטל או נמחק");
      if(result.statementImportId&&!await prisma.bankStatementImport.findFirst({where:{id:result.statementImportId,userId}})) throw ApiError.conflict("דוח הבנק בוטל או נמחק");
      if(result.loanId&&!await prisma.loan.findFirst({where:{id:result.loanId,userId}})) throw ApiError.conflict("ההלוואה שנוצרה מהלוח כבר לא קיימת");
      if(result.creditImportId) {
        const credit=await prisma.creditImport.findFirst({where:{id:result.creditImportId,userId}});
        if(!credit || credit.status!=="confirmed") throw ApiError.conflict("יש לאשר את פירוט הכרטיס לפני הסיום");
      }
      if(result.statementImportId && await prisma.bankTransaction.count({where:{userId,statementImportId:result.statementImportId,resolution:null}})) throw ApiError.conflict("נותרו תנועות בנק ללא משמעות כספית. יש להשלים התאמה.");
      if(session.status==="completed") return session;
      return prisma.importSession.update({where:{id},data:{status:"completed",version:{increment:1}}});
    });
  },
  async cancel(userId:number,id:string) {
    const changed=await prisma.importSession.updateMany({where:{id,userId,status:{in:["uploaded","processing","failed","needs_input","ready_for_review"]}},data:{status:"cancelled",version:{increment:1}}});
    if(!changed.count) throw ApiError.conflict("אי אפשר לבטל כאן ייבוא שכבר הוסיף תנועות. אפשר לבטל אותו ממסך המסמכים.");
    return owned(userId,id);
  },
};
