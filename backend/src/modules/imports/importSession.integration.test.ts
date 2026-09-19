import crypto from "node:crypto";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { prisma, withFinancialTransaction } from "../../config/database";
import { env } from "../../config/env";
import { importSessions } from "./importSession.service";
import { importRows } from "./importRows.service";
import { documentStorage } from "../documents/documentStorage.service";
import { documentsService } from "../documents/documents.service";
import { creditService } from "../credit/credit.service";
import { csrfForSession, sessionCookieName } from "../gate/sessionCookie";
let userId:number;let storage:string;let token:string;
const originalStorage=env.DOCUMENT_STORAGE_DIR;
const sheet=(rows:unknown[][])=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Data');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}) as Buffer;};
const expenseFile=()=>sheet([['שם','סכום','תאריך'],['Staged coffee',18,'17/09/2026']]);
const headers=()=>({Cookie:`${sessionCookieName}=${token}`,'X-CSRF-Token':csrfForSession(token),Origin:'http://localhost:5173'});
beforeAll(async()=>{storage=await mkdtemp(path.join(os.tmpdir(),'mj-imports-'));env.DOCUMENT_STORAGE_DIR=storage;});
beforeEach(async()=>{userId=(await prisma.user.create({data:{name:'__staged_import_test',email:`${crypto.randomUUID()}@example.test`}})).id;token=crypto.randomBytes(32).toString('hex');await prisma.gateSession.create({data:{userId,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}});});
afterEach(async()=>{vi.restoreAllMocks();await prisma.user.delete({where:{id:userId}});});
afterAll(async()=>{env.DOCUMENT_STORAGE_DIR=originalStorage;await rm(storage,{recursive:true,force:true});await prisma.$disconnect();});

describe('staged import lifecycle',()=>{
 it('persists a failed parse and retries the same uploaded file',async()=>{
  const failed=await importSessions.create(userId,'expenses.pdf',expenseFile(),{kind:'bank'});
  expect(failed.status).toBe('failed');expect((await importSessions.get(userId,failed.id)).error).toBeTruthy();
  const ready=await importSessions.answer(userId,failed.id,failed.version,{kind:'expense_sheet'});
  expect(ready.status).toBe('ready_for_review');expect(await prisma.expense.count({where:{userId}})).toBe(0);
 });
 it('edits a source row, records exact lineage, and retries without reading deleted bytes',async()=>{
  let session=await importSessions.create(userId,'expenses.xlsx',expenseFile(),{kind:'expense_sheet'});
  session=await withFinancialTransaction(userId,()=>importRows.edit(userId,session.id,1,{version:session.version,resolution:'include',normalized:{date:'2026-09-18',name:'Corrected coffee',amount:20}}));
  await importSessions.commit(userId,session.id,session.version);
  const expense=await prisma.expense.findFirstOrThrow({where:{userId}});expect(Number(expense.amount)).toBe(20);expect(expense.businessName).toBe('Corrected coffee');
  const rows=await importRows.list(userId,session.id);expect(rows.items[0].outputRef).toMatchObject({kind:'expense',id:expense.id});
  await importSessions.finish(userId,session.id);
  await unlink(documentStorage.resolve(session.storagePath)!);
  expect((await importSessions.commit(userId,session.id,session.version)).status).toBe('completed');
  await expect(importSessions.commit(userId,session.id,99999)).rejects.toThrow();
  expect(await prisma.expense.count({where:{userId}})).toBe(1);
 });
 it('requires a duplicate decision, keeps equal real occurrences, and revalidates the match',async()=>{
  const existing=await prisma.expense.create({data:{userId,businessName:'Staged coffee',amount:18,expenseDate:new Date('2026-09-17')}});
  const file=sheet([['שם','סכום','תאריך'],['Staged coffee',18,'17/09/2026'],['Staged coffee',18,'17/09/2026']]);
  let session=await importSessions.create(userId,'twins.xlsx',file,{kind:'expense_sheet'});
  expect((await importRows.list(userId,session.id)).pendingCount).toBe(1);
  await expect(importSessions.commit(userId,session.id,session.version)).rejects.toThrow();
  session=await withFinancialTransaction(userId,()=>importRows.edit(userId,session.id,1,{version:session.version,resolution:'duplicate',candidateId:existing.id,candidateKind:'expense'}));
  await importSessions.commit(userId,session.id,session.version);
  expect(await prisma.expense.count({where:{userId}})).toBe(2);
  const rows=await importRows.list(userId,session.id);expect(rows.items[0].outputRef).toMatchObject({kind:'expense',id:existing.id});
 });
 it('keeps two genuinely identical rows in one file as two separate expenses when nothing pre-existing matches them',async()=>{
  const file=sheet([['שם','סכום','תאריך'],['Twin coffee',18,'17/09/2026'],['Twin coffee',18,'17/09/2026']]);
  const session=await importSessions.create(userId,'twins-fresh.xlsx',file,{kind:'expense_sheet'});
  expect((await importRows.list(userId,session.id)).pendingCount).toBe(0);
  await importSessions.commit(userId,session.id,session.version);
  expect(await prisma.expense.count({where:{userId,businessName:'Twin coffee'}})).toBe(2);
 });
 it('rejects commit when a candidate was deleted or a new duplicate appeared',async()=>{
  const session=await importSessions.create(userId,'expense.xlsx',expenseFile(),{kind:'expense_sheet'});
  await prisma.expense.create({data:{userId,businessName:'Staged coffee',amount:18,expenseDate:new Date('2026-09-17')}});
  await expect(importSessions.commit(userId,session.id,session.version)).rejects.toThrow('השתנו');
  expect(await prisma.expense.count({where:{userId}})).toBe(1);
 });
 it('rolls back domain rows if required provenance cannot be recorded',async()=>{
  const session=await importSessions.create(userId,'expense.xlsx',expenseFile(),{kind:'expense_sheet'});
  vi.spyOn(documentsService,'record').mockRejectedValueOnce(new Error('provenance failure'));
  await expect(importSessions.commit(userId,session.id,session.version)).rejects.toThrow('provenance failure');
  expect(await prisma.expense.count({where:{userId}})).toBe(0);
  expect((await importSessions.get(userId,session.id)).status).toBe('ready_for_review');
 });
 it('keeps shared bytes and does not delete them when metadata deletion rolls back',async()=>{
  const buffer=expenseFile();const fileHash=crypto.createHash('sha256').update(buffer).digest('hex');
  const input={required:true,fileName:'shared.xlsx',fileHash,sizeBytes:buffer.length,kind:'expense_sheet' as const,buffer};
  const first=(await documentsService.record(userId,input))!;const second=(await documentsService.record(userId,input))!;
  const doc=await prisma.document.findUniqueOrThrow({where:{id:first}});
  await documentsService.remove(userId,first);
  expect(await readFile(documentStorage.resolve(doc.storagePath!)!)).toEqual(buffer);
  await expect(withFinancialTransaction(userId,async()=>{await documentsService.remove(userId,second);throw new Error('rollback metadata');})).rejects.toThrow();
  expect(await readFile(documentStorage.resolve(doc.storagePath!)!)).toEqual(buffer);
  expect(await prisma.document.count({where:{userId}})).toBe(1);
 });
 it('stages legacy endpoints without writing financial records',async()=>{
  const response=await request(app).post('/api/imports/expenses').set(headers()).field('year','2026').field('month','9').attach('file',expenseFile(),'expenses.xlsx');
  expect(response.status).toBe(202);expect(response.body.requiresReview).toBe(true);expect(response.body.sessionId).toBeTruthy();
  expect(await prisma.expense.count({where:{userId}})).toBe(0);
 });
 it('imports and rolls back a real bank file with session lifecycle and retained bytes',async()=>{
  const account=await prisma.bankAccount.create({data:{userId,bankName:'test',accountName:'test'}});
  const buffer=await readFile(path.join(process.cwd(),'tests/fixtures/bank-statement.xlsx'));
  const session=await importSessions.create(userId,'statement.xlsx',buffer,{kind:'bank',accountId:account.id});
  expect(session.status).toBe('ready_for_review');
  const committed=await importSessions.commit(userId,session.id,session.version);
  const result=committed.result as {documentId:number;statementImportId:number};
  await importSessions.finish(userId,session.id);
  await expect(documentsService.remove(userId,result.documentId)).rejects.toThrow();
  await documentsService.rollback(userId,result.documentId);
  expect((await importSessions.get(userId,session.id)).status).toBe('rolled_back');
  await expect(importSessions.finish(userId,session.id)).rejects.toThrow();
  expect(await readFile(documentStorage.resolve(session.storagePath)!)).toEqual(buffer);
  expect((await importSessions.create(userId,'statement.xlsx',buffer,{kind:'bank',accountId:account.id})).id).not.toBe(session.id);
 });
 it('reviews a real PDF statement before creating bank rows',async()=>{
  const account=await prisma.bankAccount.create({data:{userId,bankName:'test',accountName:'PDF'}});
  const file=await readFile(path.join(process.cwd(),'tests/fixtures/bank-statement.pdf'));
  const session=await importSessions.create(userId,'bank.pdf',file,{kind:'bank',accountId:account.id});
  expect(session.status).toBe('ready_for_review');expect(await prisma.bankTransaction.count({where:{userId}})).toBe(0);
  await importSessions.commit(userId,session.id,session.version);
  expect(await prisma.bankTransaction.count({where:{userId}})).toBeGreaterThan(0);
 });
 it('rejects concurrent stale row edits and foreign session access',async()=>{
  const session=await importSessions.create(userId,'expense.xlsx',expenseFile(),{kind:'expense_sheet'});
  const edit={version:session.version,resolution:'include',normalized:{date:'2026-09-17',name:'Staged coffee',amount:20}};
  const responses=await Promise.all([request(app).patch(`/api/imports/sessions/${session.id}/rows/1`).set(headers()).send(edit),request(app).patch(`/api/imports/sessions/${session.id}/rows/1`).set(headers()).send(edit)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  await expect(importRows.list(-1,session.id)).rejects.toThrow();
 });
 it('imports real credit and schedule files through review and links every row',async()=>{
  const card=await prisma.creditCard.create({data:{userId,name:'test',issuer:'test',lastFour:'1234'}});
  const credit=await importSessions.create(userId,'credit.xlsx',await readFile(path.join(process.cwd(),'tests/fixtures/credit-statement.xlsx')),{kind:'credit',cardId:card.id});
  expect(credit.status).toBe('ready_for_review');
  const committed=await importSessions.commit(userId,credit.id,credit.version);
  await expect(importSessions.finish(userId,credit.id)).rejects.toThrow();
  await creditService.confirmImport(userId,(committed.result as {creditImportId:number}).creditImportId);
  expect((await importSessions.finish(userId,credit.id)).status).toBe('completed');
  const schedule=await importSessions.create(userId,'schedule.xlsx',await readFile(path.join(process.cwd(),'tests/fixtures/loan-schedule-1.xlsx')),{kind:'loan_schedule'});
  expect(schedule.status).toBe('ready_for_review');
  await importSessions.commit(userId,schedule.id,schedule.version);
  expect((await importSessions.finish(userId,schedule.id)).status).toBe('completed');
  expect((await importRows.list(userId,schedule.id)).items.every(r=>r.outputRef!==null)).toBe(true);
 });
});
