import { prisma } from "../../config/database";
export async function invalidateImportSessions(userId:number,source:{creditImportId?:number;statementImportId?:number}) {
  const sessions=await prisma.importSession.findMany({where:{userId,status:{in:["review","completed"]}}});
  const ids=sessions.filter(s=>{
    const result=s.result as {creditImportId?:number;statementImportId?:number}|null;
    return (source.creditImportId&&result?.creditImportId===source.creditImportId)||(source.statementImportId&&result?.statementImportId===source.statementImportId);
  }).map(s=>s.id);
  if(ids.length) await prisma.importSession.updateMany({where:{id:{in:ids},userId},data:{status:"rolled_back",version:{increment:1},error:"נתוני המקור בוטלו. אפשר להעלות את הקובץ מחדש"}});
  await prisma.financialProfile.updateMany({where:{userId},data:{reviewedAt:null,revision:{increment:1}}});
}

export async function sessionSourceExists(userId:number,result:unknown):Promise<boolean> {
  const refs=result as {documentId?:number;creditImportId?:number;statementImportId?:number;loanId?:number;details?:{expenseIds?:number[]}}|null;
  if(!refs) return false;
  if(refs.documentId&&!await prisma.document.findFirst({where:{id:refs.documentId,userId,status:"imported"}})) return false;
  if(refs.creditImportId&&!await prisma.creditImport.findFirst({where:{id:refs.creditImportId,userId}})) return false;
  if(refs.statementImportId&&!await prisma.bankStatementImport.findFirst({where:{id:refs.statementImportId,userId}})) return false;
  if(refs.loanId&&!await prisma.loan.findFirst({where:{id:refs.loanId,userId}})) return false;
  if(refs.details?.expenseIds?.length&&!await prisma.expense.count({where:{userId,id:{in:refs.details.expenseIds}}})) return false;
  return true;
}
