import { Router } from "express";
import { z } from "zod";
import { prisma, withFinancialTransaction } from "../../config/database";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { commitments } from "./commitments.service";
import { financialStatus, getProfile } from "./coverage.service";
import { review } from "./review.service";
import { businessDate, json } from "./journey.utils";
import { checkIns } from "./checkin.service";
export const journeyRoutes=Router(); journeyRoutes.use(gateAuth);
const money=z.number().finite().min(0).max(9999999999);
journeyRoutes.get("/status",asyncHandler(async(req,res)=>{res.json(await financialStatus(req.userId!));}));
journeyRoutes.get("/profile",asyncHandler(async(req,res)=>{res.json(await getProfile(req.userId!));}));
journeyRoutes.patch("/profile",asyncHandler(async(req,res)=>{
  const body=z.object({scope:z.object({accountsListed:z.literal(true),cardsListed:z.literal(true),commitmentsListed:z.literal(true),manualOnly:z.boolean().default(false)}).optional(),cashBuffer:money.optional(),essentialReserve:money.optional(),savedReserve:money.optional()}).strict().parse(req.body);
  await getProfile(req.userId!);
  res.json(await prisma.financialProfile.update({where:{userId:req.userId!},data:{...body,scope:body.scope?json(body.scope):undefined,reviewedAt:null}}));
}));
journeyRoutes.post("/coverage",asyncHandler(async(req,res)=>{
  const body=z.object({dataVersion:z.string().length(64),confirmed:z.literal(true)}).parse(req.body);
  const state=await financialStatus(req.userId!);
  if(state.dataVersion!==body.dataVersion) throw ApiError.conflict("הנתונים השתנו. יש לרענן לפני אישור העדכניות");
  res.json(await prisma.financialProfile.update({where:{userId:req.userId!},data:{coverage:json({date:businessDate(),dataVersion:state.dataVersion}),reviewedAt:new Date()}}));
}));
journeyRoutes.post("/onboarding/defer",asyncHandler(async(req,res)=>{await getProfile(req.userId!);await prisma.financialProfile.updateMany({where:{userId:req.userId!,onboarding:"pending"},data:{onboarding:"deferred"}});res.json({ok:true});}));
journeyRoutes.post("/onboarding/complete",asyncHandler(async(req,res)=>{
  const body=z.object({reviewed:z.literal(true),noActivity:z.boolean().default(false)}).parse(req.body);
  res.json(await withFinancialTransaction(req.userId!,async()=>{
    const state=await financialStatus(req.userId!);
    if(!state.profile.scope || state.issues.some(i=>i.blocking)) throw ApiError.conflict("יש להגדיר את המקורות ולהשלים את הקליטה והבדיקה לפני סיום ההיכרות");
    const completed=await prisma.importSession.count({where:{userId:req.userId!,status:"completed"}});
    const manual=await prisma.expense.count({where:{userId:req.userId!}})+await prisma.income.count({where:{userId:req.userId!}});
    const scope=state.profile.scope as {manualOnly?:boolean};
    if(!completed && (!scope.manualOnly || (!manual && !body.noActivity))) throw ApiError.conflict("יש להשלים קליטה ראשונה או לבחור בהזנה ידנית ולבדוק את המידע שנרשם");
    return prisma.financialProfile.update({where:{userId:req.userId!},data:{onboarding:"completed",completedAt:new Date(),reviewedAt:new Date()}});
  }));
}));
journeyRoutes.get("/review",asyncHandler(async(req,res)=>{res.json(await review(req.userId!));}));
journeyRoutes.get("/commitments",asyncHandler(async(req,res)=>{res.json(await commitments(req.userId!));}));
journeyRoutes.post("/commitments/decision",asyncHandler(async(req,res)=>{
  const body=z.object({key:z.string().max(160),fingerprint:z.string().length(64),decision:z.enum(["unpaid","paid","duplicate"]),note:z.string().trim().min(3).max(255),bankTransactionId:z.number().int().positive().optional(),relatedEventKey:z.string().max(160).optional()}).parse(req.body);
  res.json(await withFinancialTransaction(req.userId!,async()=>{
    const events=await commitments(req.userId!); const event=events.find(e=>e.key===body.key);
    if(!event||event.fingerprint!==body.fingerprint) throw ApiError.conflict("ההתחייבות השתנתה — יש לרענן");
    if(body.decision==="duplicate") {
      const other=events.find(e=>e.key===body.relatedEventKey);
      if(!other||other.key===event.key||other.decision!=="unpaid") throw ApiError.badRequest("יש לבחור את החיוב שכולל את ההתחייבות, ולוודא שהוא מסומן כטרם שולם");
      if(other.amount===null||event.amount===null||event.amount<=0||other.amount<event.amount) throw ApiError.badRequest("החיוב המקושר חייב לכסות את סכום ההתחייבות");
      const allocated=await prisma.commitmentDecision.findMany({where:{userId:req.userId!,decision:"duplicate",relatedEventKey:other.key,eventKey:{not:event.key}}});
      const used=allocated.reduce((sum,record)=>{
        const row=events.find(e=>e.key===record.eventKey&&e.fingerprint===record.fingerprint);
        return sum+(row?.amount!=null?Math.max(0,Math.round(row.amount*100)):0);
      },0);
      if(used+Math.round(event.amount*100)>Math.round(other.amount*100)) throw ApiError.conflict("סכום ההתחייבויות המשויכות עולה על החיוב המקושר");
    }
    if(body.bankTransactionId) {
      if(body.decision!=="paid") throw ApiError.badRequest("אפשר לשייך תנועת בנק רק להתחייבות ששולמה");
      const transaction=await prisma.bankTransaction.findFirst({where:{id:body.bankTransactionId,userId:req.userId!}});
      if(!transaction || transaction.type==="deposit" || event.amount===null || Number(transaction.amount)!==event.amount || transaction.transactionDate>new Date(businessDate())) throw ApiError.badRequest("תנועת הבנק אינה תואמת לתשלום");
      const used=await prisma.commitmentDecision.findFirst({where:{userId:req.userId!,decision:"paid",bankTransactionId:body.bankTransactionId,eventKey:{not:body.key}}});
      if(used) throw ApiError.conflict("תנועה זו כבר משויכת להתחייבות אחרת");
    }
    // This row holds the current decision: record when its evidence was last
    // verified, including replacements, so subsequent payment edits invalidate it.
    const data={fingerprint:body.fingerprint,decision:body.decision,note:body.note,bankTransactionId:body.decision==="paid"?body.bankTransactionId??null:null,relatedEventKey:body.decision==="duplicate"?body.relatedEventKey??null:null,createdAt:new Date()};
    return prisma.commitmentDecision.upsert({where:{userId_eventKey:{userId:req.userId!,eventKey:body.key}},create:{userId:req.userId!,eventKey:body.key,...data},update:data});
  }));
}));
journeyRoutes.get("/check-in",asyncHandler(async(req,res)=>{res.json(await checkIns.current(req.userId!));}));
journeyRoutes.post("/check-in",asyncHandler(async(req,res)=>{res.json(await checkIns.start(req.userId!));}));
journeyRoutes.patch("/check-in/:id",asyncHandler(async(req,res)=>{res.json(await checkIns.advance(req.userId!,z.string().uuid().parse(req.params.id),z.number().int().parse(req.body.step)));}));
journeyRoutes.post("/check-in/:id/complete",asyncHandler(async(req,res)=>{res.json(await checkIns.complete(req.userId!,z.string().uuid().parse(req.params.id),z.string().length(64).parse(req.body.token)));}));
