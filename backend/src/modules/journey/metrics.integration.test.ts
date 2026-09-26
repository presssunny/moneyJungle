import crypto from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "../../config/database";
import { financialMetric } from "./metrics.service";
import { financialStatus } from "./coverage.service";
import { businessDate, nextDate } from "./journey.utils";
let userId:number;let otherId:number;
beforeAll(async()=>{
 userId=(await prisma.user.create({data:{name:"__metric",email:`${crypto.randomUUID()}@example.test`}})).id;
 otherId=(await prisma.user.create({data:{name:"__metric_other",email:`${crypto.randomUUID()}@example.test`}})).id;
 await prisma.expense.createMany({data:Array.from({length:52},(_,i)=>({userId,amount:1.01,businessName:`item ${i}`,expenseDate:new Date("2026-09-01")}))});
 await prisma.income.create({data:{userId,type:"extra",amount:100,incomeDate:new Date("2026-09-01")}});
 const batch=await prisma.creditImport.create({data:{userId,fileName:"metric",importMonth:9,importYear:2026,status:"confirmed"}});
 await prisma.creditTransaction.createMany({data:[{amount:10,transactionType:"regular"},{amount:-2,transactionType:"regular"},{amount:500,transactionType:"financing"}].map(row=>({...row,userId,creditImportId:batch.id,businessName:"credit",billingDate:new Date("2026-09-02"),transactionDate:new Date("2026-09-02")}))});
 const pending=await prisma.creditImport.create({data:{userId,fileName:"pending",importMonth:9,importYear:2026,status:"pending"}});
 await prisma.creditTransaction.create({data:{userId,creditImportId:pending.id,businessName:"pending",amount:123,billingDate:new Date("2026-09-02"),transactionDate:new Date("2026-09-02")}});
});
afterAll(async()=>{await prisma.user.deleteMany({where:{id:{in:[userId,otherId].filter(Boolean)}}});await prisma.$disconnect();});
describe("versioned financial metric drill-down",()=>{
 it("paginates source records and reconciles expense/refund/income totals",async()=>{
  for(const name of ["income","expense","surplus"] as const){
   const first=await financialMetric(userId,name,"2026-09");
   const second=first.total>50?await financialMetric(userId,name,"2026-09",2,first.dataVersion):null;
   const rows=[...first.components,...(second?.components??[])];
   expect(rows.length).toBe(first.total);expect(new Set(rows.map(r=>r.key)).size).toBe(rows.length);
   expect(rows.reduce((sum,r)=>sum+Math.round(r.value!*100),0)/100).toBe(first.value);
   expect(first.value).toBe(name==="income"?100:name==="expense"?60.52:39.48);
   expect(first.components.length).toBeLessThanOrEqual(50);
  }
 });
 it("isolates owners and requires a stable version between pages",async()=>{
  expect((await financialMetric(otherId,"expense","2026-09")).total).toBe(0);
  const first=await financialMetric(userId,"expense","2026-09");
  await expect(financialMetric(userId,"expense","2026-09",2)).rejects.toThrow();
  await prisma.expense.create({data:{userId,amount:1,expenseDate:new Date("2026-09-03")}});
  await expect(financialMetric(userId,"expense","2026-09",2,first.dataVersion)).rejects.toThrow("המקורות השתנו");
 });
 it("does not turn absent cash coverage into a zero allowance",async()=>{
  const metric=await financialMetric(otherId,"allowance","2026-09");
  expect(metric.value).toBeNull();expect(metric.state).toBe("unavailable");expect(metric.missingData.length).toBeGreaterThan(0);
  expect((await financialMetric(otherId,"cash","2026-09")).value).toBeNull();
 });
 it("drills into the next card charge across billing months, including refunds",async()=>{
  const card=await prisma.creditCard.create({data:{userId:otherId,name:"test",issuer:"test",lastFour:"1234"}});
  const batch=await prisma.creditImport.create({data:{userId:otherId,fileName:"source.xlsx",importMonth:8,importYear:2026,status:"confirmed"}});
  const chargeDate=new Date(nextDate(businessDate(),2));
  await prisma.creditTransaction.createMany({data:[20,-5].map(amount=>({userId:otherId,cardId:card.id,creditImportId:batch.id,amount,businessName:"purchase",billingDate:new Date("2026-08-01"),transactionDate:new Date("2026-08-01"),chargeDate}))});
  const metric=await financialMetric(otherId,"creditCharge","2026-09",1,undefined,String(card.id));
  expect(metric.value).toBe(15);expect(metric.total).toBe(2);expect(metric.components[0].detail).toContain("source.xlsx");
  expect((await financialMetric(userId,"creditCharge","2026-09",1,undefined,String(card.id))).value).toBeNull();
 });
 it("leaves financing and draft imports out of the next card charge",async()=>{
  const owner=(await prisma.user.create({data:{name:"__metric_charge",email:`${crypto.randomUUID()}@example.test`}})).id;
  try{
   const chargeDate=new Date(nextDate(businessDate(),3));
   const confirmed=await prisma.creditImport.create({data:{userId:owner,fileName:"confirmed.xlsx",importMonth:9,importYear:2026,status:"confirmed"}});
   const draft=await prisma.creditImport.create({data:{userId:owner,fileName:"draft.xlsx",importMonth:9,importYear:2026,status:"pending"}});
   const base={userId:owner,businessName:"purchase",billingDate:new Date("2026-09-01"),transactionDate:new Date("2026-09-01"),chargeDate};
   await prisma.creditTransaction.createMany({data:[
    {...base,creditImportId:confirmed.id,amount:40,transactionType:"regular"},
    {...base,creditImportId:confirmed.id,amount:900,transactionType:"financing"},
    {...base,creditImportId:draft.id,amount:70,transactionType:"regular"},
   ]});
   const metric=await financialMetric(owner,"creditCharge","2026-09");
   expect(metric.value).toBe(40);expect(metric.total).toBe(1);
  }finally{await prisma.user.delete({where:{id:owner}});}
 });
 it("explains the same anchor and net movement used by Home",async()=>{
  await prisma.bankAccount.create({data:{userId:otherId,accountName:"anchor",bankName:"test",initialBalance:0,currentBalance:0,anchorBalance:500,anchorDate:new Date(businessDate())}});
  const [state,metric]=await Promise.all([financialStatus(otherId),financialMetric(otherId,"cash","2026-09")]);
  expect(metric.value).toBe(state.allowance.cash);expect(metric.components.reduce((s,c)=>s+c.value!,0)).toBe(metric.value);
 });
});
