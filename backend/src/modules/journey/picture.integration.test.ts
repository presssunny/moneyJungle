import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import app from '../../app';
import { prisma } from '../../config/database';
import { csrfForSession, sessionCookieName } from '../gate/sessionCookie';
import { financialStatus } from './coverage.service';

let userId: number;
let token: string;
const situation = { bankAccounts: 0, creditCards: 0, loans: 0, cashActivity: false };
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, 'X-CSRF-Token': csrfForSession(token), Origin: 'http://localhost:5173' });
const saveSituation = (input: Record<string, unknown>) => request(app).patch('/api/journey/situation').set(headers()).send(input);
const complete = (noActivity = true) => request(app).post('/api/journey/onboarding/complete').set(headers()).send({ reviewed: true, noActivity });
async function saveScope() {
 const response = await request(app).patch('/api/journey/profile').set(headers()).send({ scope: { accountsListed: true, cardsListed: true, commitmentsListed: true, manualOnly: true } });
 expect(response.status).toBe(200);
}
async function acknowledge(quietSourceKeys: string[] = []) {
 const state = await financialStatus(userId);
 return request(app).post('/api/journey/coverage').set(headers()).send({ dataVersion: state.dataVersion, sourceKeys: state.sources.map(s => s.key), quietSourceKeys, confirmed: true });
}
beforeEach(async () => {
 userId = (await prisma.user.create({ data: { name: '__picture_test', email: `${crypto.randomUUID()}@example.test` } })).id;
 token = crypto.randomBytes(32).toString('hex');
 await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

describe('financial picture and explicit coverage', () => {
 it('authenticates situation updates and preserves unknown answers separately from zero', async () => {
  expect((await request(app).patch('/api/journey/situation').set('Origin', 'http://localhost:5173').send(situation)).status).toBe(401);
  expect((await saveSituation({ ...situation, creditCards: null })).status).toBe(200);
  const state = await financialStatus(userId);
  expect(state.profile.situation).toEqual({ ...situation, creditCards: null });
  expect(state.picture.inventoryKnown).toBe(false);
  expect(state.picture.next?.id).toBe('situation');
  for (const bankAccounts of [-1, 101, 1.5]) expect((await saveSituation({ ...situation, bankAccounts })).status).toBe(400);
  expect((await saveSituation({ ...situation, userId: userId + 1 })).status).toBe(400);
 });

 it('keeps declared missing accounts blocking even after coverage is acknowledged', async () => {
  expect((await saveSituation({ ...situation, bankAccounts: 1 })).status).toBe(200);
  await saveScope();
  expect((await acknowledge()).status).toBe(200);
  const state = await financialStatus(userId);
  expect(state.coverageAcknowledged).toBe(true);
  expect(state.picture.requiredGaps).toHaveLength(1);
  expect(state.picture.sufficient).toBe(false);
  expect(state.allowance.amount).toBeNull();
  expect((await complete()).status).toBe(409);
 });

 it('requires a separate no-charges acknowledgement for an empty card', async () => {
  const card = await prisma.creditCard.create({ data: { userId, name: 'כרטיס לבדיקה', issuer: 'test', lastFour: '1234' } });
  const key = `credit:${card.id}`;
  expect((await saveSituation({ ...situation, creditCards: 1 })).status).toBe(200);
  await saveScope();
  expect((await acknowledge()).status).toBe(200);
  expect((await financialStatus(userId)).picture.sufficient).toBe(false);
  expect((await complete()).status).toBe(409);
  expect((await acknowledge(['credit:unknown'])).status).toBe(400);
  expect((await acknowledge([key])).status).toBe(200);
  const state = await financialStatus(userId);
  expect(state.quietSourceKeys).toEqual([key]);
  expect(state.picture.requiredGaps).toEqual([]);
  expect(state.picture.sources.find(s => s.key === key)?.status).toBe('known');
  expect((await complete()).status).toBe(200);
  expect(await prisma.creditTransaction.count({ where: { userId } })).toBe(0);
 });

 it('invalidates both coverage and no-charges acknowledgement after a situation update', async () => {
  const card = await prisma.creditCard.create({ data: { userId, name: 'כרטיס לבדיקה', issuer: 'test', lastFour: '1234' } });
  await saveSituation({ ...situation, creditCards: 1 });
  await saveScope();
  await acknowledge([`credit:${card.id}`]);
  const before = await financialStatus(userId);
  expect(before.picture.sufficient).toBe(true);
  await saveSituation({ ...situation, creditCards: 1, bankAccounts: 1 });
  const after = await financialStatus(userId);
  expect(after.dataVersion).not.toBe(before.dataVersion);
  expect(after.coverageAcknowledged).toBe(false);
  expect(after.quietSourceKeys).toEqual([]);
  expect(after.picture.sufficient).toBe(false);
  expect((await complete()).status).toBe(409);
  expect((await request(app).post('/api/journey/coverage').set(headers()).send({ dataVersion: before.dataVersion, sourceKeys: before.sources.map(s => s.key), confirmed: true })).status).toBe(409);
 });

 it('still requires the explicit no-activity choice for manual setup without transactions', async () => {
  await saveSituation(situation);
  await saveScope();
  await acknowledge();
  expect((await complete(false)).status).toBe(409);
  expect((await complete(true)).status).toBe(200);
  expect((await financialStatus(userId)).allowance.amount).toBeNull();
 });
});
