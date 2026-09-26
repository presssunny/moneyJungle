import { createHash } from "node:crypto";
import { journeyActions, upcomingCommitments } from "./actions.service";
import { prisma, withFinancialTransaction } from "../../config/database";
import { spendingCredit } from "../dashboard/dashboard.repository";
import { ApiError } from "../../utils/ApiError";
import { financialStatus } from "./coverage.service";
import { businessDate, fingerprint, json } from "./journey.utils";
interface SnapshotRow { key:string; date:string; amount:number; hash:string }
export interface CheckInSnapshot {
  version:1|2; date:string; rows:SnapshotRow[]; bankCash:number; coverageVersion:string; incomplete:boolean;
  calculationVersion?:string; windowStart?:string; historicalHash?:string; historicalCount?:number; truncated?:boolean; limitations?:string[];
}
export function compareSnapshots(previous:CheckInSnapshot|null,current:CheckInSnapshot) {
  if(!previous||previous.version!==current.version) return {baseline:true,added:0,late:0,changed:0,removed:0,cashChange:null,limited:false,historyChanged:null};
  const start=[previous.windowStart??"",current.windowStart??""].sort().at(-1)!;
  const before=new Map(previous.rows.filter(r=>r.date>=start).map(r=>[r.key,r]));
  const after=new Map(current.rows.filter(r=>r.date>=start).map(r=>[r.key,r]));
  const added=[...after.values()].filter(r=>!before.has(r.key));
  const limited=!!previous.truncated||!!current.truncated;
  return {baseline:false,added:limited?null:added.length,late:limited?null:added.filter(r=>r.date<previous.date).length,
    changed:limited?null:[...after.values()].filter(r=>before.has(r.key)&&before.get(r.key)!.hash!==r.hash).length,
    removed:limited?null:[...before.keys()].filter(key=>!after.has(key)).length,
    cashChange:previous.incomplete||current.incomplete?null:Math.round((current.bankCash-previous.bankCash)*100)/100,
    limited,historyChanged:previous.windowStart===current.windowStart?previous.historicalHash!==current.historicalHash:null};
}
function snapshotAccumulator(date:string) {
  const d=new Date(date);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-2);
  const windowStart=d.toISOString().slice(0,10);
  const recent:SnapshotRow[]=[];const historical=createHash("sha256");let historicalCount=0;let truncated=false;
  return {
    add(row:SnapshotRow) {
      if(row.date>=windowStart&&recent.length<1000) recent.push(row);
      else {historical.update(JSON.stringify(row));historicalCount++;if(row.date>=windowStart)truncated=true;}
    },
    finish:()=>({rows:recent,windowStart,historicalHash:historical.digest("hex"),historicalCount,truncated}),
  };
}
export function compactSnapshot(rows:SnapshotRow[],date:string) {
  const accumulator=snapshotAccumulator(date);for(const row of rows)accumulator.add(row);return accumulator.finish();
}
async function snapshot(userId:number) {
  const status=await financialStatus(userId);
  const accumulator=snapshotAccumulator(status.today);
  const readers:Array<(after:number)=>Promise<SnapshotRow[]>>=[
    async after=>(await prisma.expense.findMany({where:{userId,id:{gt:after}},select:{id:true,expenseDate:true,amount:true,updatedAt:true},orderBy:{id:"asc"},take:500})).map(r=>({key:`expense:${r.id}`,date:r.expenseDate.toISOString().slice(0,10),amount:-Number(r.amount),hash:fingerprint(r)})),
    async after=>(await prisma.income.findMany({where:{userId,id:{gt:after}},select:{id:true,incomeDate:true,amount:true,updatedAt:true},orderBy:{id:"asc"},take:500})).map(r=>({key:`income:${r.id}`,date:r.incomeDate.toISOString().slice(0,10),amount:Number(r.amount),hash:fingerprint(r)})),
    async after=>(await prisma.creditTransaction.findMany({where:{userId,id:{gt:after},...spendingCredit},select:{id:true,billingDate:true,amount:true,updatedAt:true},orderBy:{id:"asc"},take:500})).map(r=>({key:`credit:${r.id}`,date:r.billingDate.toISOString().slice(0,10),amount:-Number(r.amount),hash:fingerprint(r)})),
  ];
  for(const read of readers) {
    let cursor=0;
    for(;;) {
      const rows=await read(cursor);for(const row of rows)accumulator.add(row);
      if(rows.length<500)break;
      cursor=Number(rows[rows.length-1].key.split(":")[1]);
    }
  }
  const result:CheckInSnapshot={version:2,calculationVersion:"cash-v1",date:businessDate(),...accumulator.finish(),bankCash:status.allowance.cash,coverageVersion:status.dataVersion,incomplete:status.blockers.length>0,limitations:status.blockers};
  const ranked=await journeyActions(userId,status);
  const first=ranked[0];
  const action=first?{title:first.title,to:first.to,reason:first.reason}:{title:"שמירה על עדכניות התמונה בשבוע הבא",to:"/data",reason:"לא נמצאה כרגע פעולה המחייבת טיפול במקורות הרשומים"};
  return {snapshot:result,token:fingerprint(result),action,status:{...status,upcoming:upcomingCommitments(status)}};
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
  async advance(userId:number,id:string,step:number) {return withFinancialTransaction(userId,async()=>{
    if(step<1||step>3) throw ApiError.badRequest("שלב לא תקין");
    if(step>=2 && (await financialStatus(userId)).issues.some(i=>i.blocking)) throw ApiError.conflict("יש להשלים את הפריטים החוסמים לפני מעבר להבנת התמונה");
    const changed=await prisma.moneyCheckIn.updateMany({where:{id,userId,status:"draft",step:step-1},data:{step}});
    if(!changed.count) throw ApiError.conflict("השלב השתנה; יש לרענן");
    return this.current(userId);
  });},
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
