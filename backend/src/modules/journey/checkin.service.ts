import { prisma, withFinancialTransaction } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { financialStatus } from "./coverage.service";
import { businessDate, fingerprint, json } from "./journey.utils";
interface SnapshotRow { key:string; date:string; amount:number; hash:string }
export interface CheckInSnapshot { version:1; date:string; rows:SnapshotRow[]; bankCash:number; coverageVersion:string; incomplete:boolean }
export function compareSnapshots(previous:CheckInSnapshot|null,current:CheckInSnapshot) {
  if(!previous) return {baseline:true,added:0,late:0,changed:0,removed:0,cashChange:null};
  const before=new Map(previous.rows.map(r=>[r.key,r])); const after=new Map(current.rows.map(r=>[r.key,r]));
  const added=current.rows.filter(r=>!before.has(r.key));
  return {baseline:false,added:added.length,late:added.filter(r=>r.date<previous.date).length,
    changed:current.rows.filter(r=>before.has(r.key)&&before.get(r.key)!.hash!==r.hash).length,
    removed:previous.rows.filter(r=>!after.has(r.key)).length,
    cashChange:previous.incomplete||current.incomplete?null:Math.round((current.bankCash-previous.bankCash)*100)/100};
}
async function snapshot(userId:number) {
  const [status,expenses,incomes,credit]=await Promise.all([financialStatus(userId),
    prisma.expense.findMany({where:{userId},orderBy:{id:"asc"}}),prisma.income.findMany({where:{userId},orderBy:{id:"asc"}}),
    prisma.creditTransaction.findMany({where:{userId,creditImport:{status:"confirmed"},transactionType:{not:"financing"}},orderBy:{id:"asc"}})]);
  const rows:SnapshotRow[]=[...expenses.map(r=>({key:`expense:${r.id}`,date:r.expenseDate.toISOString().slice(0,10),amount:-Number(r.amount),hash:fingerprint(r)})),
    ...incomes.map(r=>({key:`income:${r.id}`,date:r.incomeDate.toISOString().slice(0,10),amount:Number(r.amount),hash:fingerprint(r)})),
    ...credit.map(r=>({key:`credit:${r.id}`,date:r.billingDate.toISOString().slice(0,10),amount:-Number(r.amount),hash:fingerprint(r)}))];
  const result:CheckInSnapshot={version:1,date:businessDate(),rows,bankCash:status.allowance.cash,coverageVersion:status.dataVersion,incomplete:status.blockers.length>0};
  const goal=await prisma.savingsGoal.findFirst({where:{userId},orderBy:{id:"asc"}});
  const issue=status.issues[0];
  const action=issue?{title:issue.title,to:issue.to}:status.blockers.length?{title:"עדכון המקורות וההתחייבויות ישלים את תמונת הכסף",to:"/data"}:goal?{title:`בדיקת ההתקדמות ביעד: ${goal.goalName}`,to:"/accounts?tab=savings"}:{title:"בחירת יעד קטן לחודש הקרוב",to:"/budgets"};
  return {snapshot:result,token:fingerprint(result),action,status};
}
export const checkIns={
  async current(userId:number) {
    const [draft,previous,view]=await Promise.all([
      prisma.moneyCheckIn.findFirst({where:{userId,status:"draft"},orderBy:{createdAt:"desc"}}),
      prisma.moneyCheckIn.findFirst({where:{userId,status:"completed"},orderBy:{completedAt:"desc"}}),snapshot(userId)]);
    const due=!previous?.completedAt || Date.now()-previous.completedAt.getTime()>=7*86400000;
    return {draft,previousCompletedAt:previous?.completedAt??null,due,comparison:compareSnapshots(previous?.snapshot as unknown as CheckInSnapshot|null,view.snapshot),token:view.token,action:view.action,status:view.status};
  },
  async start(userId:number) {return withFinancialTransaction(userId,async()=>{
    return await prisma.moneyCheckIn.findFirst({where:{userId,status:"draft"}})??await prisma.moneyCheckIn.create({data:{userId}});
  });},
  async advance(userId:number,id:string,step:number) {
    if(step<1||step>3) throw ApiError.badRequest("שלב לא תקין");
    if(step>=2 && (await financialStatus(userId)).issues.some(i=>i.blocking)) throw ApiError.conflict("יש להשלים את הפריטים החוסמים לפני מעבר להבנת התמונה");
    const changed=await prisma.moneyCheckIn.updateMany({where:{id,userId,status:"draft",step:step-1},data:{step}});
    if(!changed.count) throw ApiError.conflict("השלב השתנה; יש לרענן");
    return this.current(userId);
  },
  async complete(userId:number,id:string,token:string) {return withFinancialTransaction(userId,async()=>{
    const current=await prisma.moneyCheckIn.findFirst({where:{id,userId}});
    if(!current) throw ApiError.notFound("הבדיקה לא נמצאה");
    if(current.status==="completed") return current;
    if(current.step!==3) throw ApiError.conflict("יש לעבור על ארבעת שלבי הבדיקה");
    const view=await snapshot(userId);
    if(view.token!==token) throw ApiError.conflict("הנתונים השתנו מאז פתיחת הסיכום. יש לרענן ולבדוק אותם.");
    if(view.status.issues.some(i=>i.blocking)) throw ApiError.conflict("נותרו פריטים המחייבים בדיקה");
    return prisma.moneyCheckIn.update({where:{id},data:{status:"completed",completedAt:new Date(),snapshot:json(view.snapshot),action:json(view.action)}});
  });},
};
