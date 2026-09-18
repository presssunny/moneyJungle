import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import * as XLSX from "xlsx";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import app from "../../app";
import { prisma, withFinancialTransaction } from "../../config/database";
import { env } from "../../config/env";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
import { importSessions } from "../imports/importSession.service";
import { importsService } from "../imports/imports.service";
import { creditService } from "../credit/credit.service";
import { financialStatus } from "./coverage.service";
import { checkIns, compareSnapshots, type CheckInSnapshot } from "./checkin.service";
import { businessDate } from "./journey.utils";
let userId:number;let otherId:number;let token:string;let storage:string;const originalStorage=env.DOCUMENT_STORAGE_DIR;
const sheet=(rows:unknown[][])=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Data');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer;};
beforeAll(async()=>{
 storage=await mkdtemp(path.join(os.tmpdir(),'mj-journey-test-'));env.DOCUMENT_STORAGE_DIR=storage;
 userId=(await prisma.user.create({data:{name:'__journey_test',email:`${crypto.randomUUID()}@example.test`}})).id;
 otherId=(await prisma.user.create({data:{name:'__journey_other',email:`${crypto.randomUUID()}@example.test`}})).id;
 token=crypto.randomBytes(32).toString('hex');await prisma.gateSession.create({data:{userId,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
},30000);
afterAll(async()=>{vi.restoreAllMocks();if(userId)await prisma.user.deleteMany({where:{id:{in:[userId,otherId].filter(Boolean)}}});await prisma.$disconnect();env.DOCUMENT_STORAGE_DIR=originalStorage;if(storage)await rm(storage,{recursive:true,force:true});});
const headers=()=>({'Cookie':`${sessionCookieName}=${token}`,'X-CSRF-Token':csrfForSession(token),'Origin':'http://localhost:5173'});
describe('persisted financial journey',()=>{
 it('protects all new read routes',async()=>{for(const route of ['/api/journey/status','/api/journey/review','/api/journey/check-in','/api/imports/sessions'])expect((await request(app).get(route)).status).toBe(401);});
 it('rejects completion before declared sources and reviewed inputs',async()=>{expect((await request(app).post('/api/journey/onboarding/complete').set(headers()).send({reviewed:true})).status).toBe(409);});
 it('retains questions and account ownership across reloads',async()=>{
   const s=await importSessions.create(userId,'expenses.xlsx',sheet([['שם','סכום'],['מכולת',25]]),{kind:'expense_sheet'});
   expect(s.status).toBe('needs_input');expect((await importSessions.get(userId,s.id)).preview).toEqual(s.preview);
   await expect(importSessions.get(otherId,s.id)).rejects.toThrow();
   const ready=await importSessions.answer(userId,s.id,s.version,{month:'2026-09'});expect(ready.status).toBe('ready_for_review');
   await expect(importSessions.answer(userId,s.id,s.version,{month:'2026-08'})).rejects.toThrow();
   await importSessions.cancel(userId,s.id);
 });
 it('commits expense rows and session outputs atomically, including concurrent retries',async()=>{
   const s=await importSessions.create(userId,'same.xlsx',sheet([['שם','סכום','תאריך'],['קפה',18,'17/09/2026'],['קפה',18,'17/09/2026']]),{kind:'expense_sheet',month:'2026-09'});
   const before=await prisma.expense.count({where:{userId}});
   const [a,b]=await Promise.all([importSessions.commit(userId,s.id,s.version),importSessions.commit(userId,s.id,s.version)]);
   expect(a.status).toBe('review');expect(b.id).toBe(a.id);expect(await prisma.expense.count({where:{userId}})).toBe(before+2);
   const done=await importSessions.finish(userId,s.id);expect(done.status).toBe('completed');
   expect((done.result as {details:{expenseIds:number[]}}).details.expenseIds).toHaveLength(2);
 });
 it('rolls back financial writes when an importer fails after writing',async()=>{
   const s=await importSessions.create(userId,'rollback.xlsx',sheet([['שם','סכום','תאריך'],['בדיקת כשל',27,'17/09/2026']]),{kind:'expense_sheet',month:'2026-09'});
   const count=await prisma.expense.count({where:{userId}});
   const original=importsService.importExpenses.bind(importsService);
   const spy=vi.spyOn(importsService,'importExpenses').mockImplementationOnce(async(...args)=>{await original(...args);throw new Error('synthetic failure');});
   await expect(importSessions.commit(userId,s.id,s.version)).rejects.toThrow('synthetic failure');spy.mockRestore();
   expect(await prisma.expense.count({where:{userId}})).toBe(count);expect((await importSessions.get(userId,s.id)).status).toBe('ready_for_review');await importSessions.cancel(userId,s.id);
 });
 it('nested transactions do not commit independently',async()=>{
   await expect(withFinancialTransaction(userId,async()=>{await prisma.$transaction(async tx=>{await tx.income.create({data:{userId,type:'extra',amount:123,incomeDate:new Date()}});});throw new Error('rollback');})).rejects.toThrow();
   expect(await prisma.income.count({where:{userId}})).toBe(0);
 });
 it('does not collapse two identical card purchases inside a statement',async()=>{
   const file=sheet([['תאריך עסקה','שם בית עסק','סכום','מועד חיוב'],['17/09/2026','Twin',12,'20/09/2026'],['17/09/2026','Twin',12,'20/09/2026']]);
   const result=await creditService.createImport(userId,'twins.xlsx',file);expect(result.alreadyImported).toBe(false);expect(await prisma.creditTransaction.count({where:{userId,businessName:'Twin'}})).toBe(2);
   const again=await creditService.createImport(userId,'renamed.xlsx',file);expect(again.alreadyImported).toBe(true);
   if(!result.alreadyImported) await creditService.removeImport(userId,result.id);
 });
 it('cannot produce an allowance from missing bank data',async()=>{const status=await financialStatus(userId);expect(status.allowance.amount).toBeNull();expect(status.blockers.length).toBeGreaterThan(0);});
 it('marks setup complete only through server validation',async()=>{
   const saved=await request(app).patch('/api/journey/profile').set(headers()).send({scope:{accountsListed:true,cardsListed:true,commitmentsListed:true,manualOnly:false}});expect(saved.status).toBe(200);
   const done=await request(app).post('/api/journey/onboarding/complete').set(headers()).send({reviewed:true});expect(done.status).toBe(200);expect(done.body.onboarding).toBe('completed');
 });
 it('resumes one check-in and does not complete skipped steps',async()=>{
   const [a,b]=await Promise.all([checkIns.start(userId),checkIns.start(userId)]);expect(a.id).toBe(b.id);
   await expect(checkIns.complete(userId,a.id,'0'.repeat(64))).rejects.toThrow();
   await checkIns.advance(userId,a.id,1);await checkIns.advance(userId,a.id,2);await checkIns.advance(userId,a.id,3);
   const current=await checkIns.current(userId);expect(current.comparison.baseline).toBe(true);
   await expect(checkIns.complete(userId,a.id,'0'.repeat(64))).rejects.toThrow();
   const completed=await checkIns.complete(userId,a.id,current.token);expect(completed.status).toBe('completed');expect((await checkIns.complete(userId,a.id,current.token)).id).toBe(a.id);
 });
 it('labels late historical imports separately from new activity',()=>{
   const previous:CheckInSnapshot={version:1,date:businessDate(),rows:[{key:'expense:1',date:'2026-01-01',amount:10,hash:'a'}],bankCash:0,coverageVersion:'a',incomplete:true};
   const next:CheckInSnapshot={...previous,rows:[{key:'expense:1',date:'2026-01-01',amount:20,hash:'b'},{key:'expense:2',date:'2025-01-01',amount:30,hash:'c'}]};
   expect(compareSnapshots(previous,next)).toMatchObject({added:1,late:1,changed:1,removed:0,cashChange:null});
 });
});
