import crypto from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import app from "../app";
import { prisma } from "../config/database";
import { csrfForSession, sessionCookieName } from "../modules/gate/sessionCookie";
import { fileKind, MAX_UPLOAD_BYTES } from "./upload.middleware";

let userId: number;
let token: string;
let accountId: number;
const headers = () => ({ Cookie: `${sessionCookieName}=${token}`, "X-CSRF-Token": csrfForSession(token), Origin: "http://localhost:5173" });

beforeEach(async () => {
  userId = (await prisma.user.create({ data: { name: "__upload_guard_test", email: `${crypto.randomUUID()}@example.test` } })).id;
  token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } });
  accountId = (await prisma.bankAccount.create({ data: { userId, bankName: "test", accountName: "עו״ש" } })).id;
});
afterEach(async () => { await prisma.user.delete({ where: { id: userId } }); });
afterAll(async () => { await prisma.$disconnect(); });

/** A zip whose central directory claims one entry of `size` uncompressed bytes. */
function zipClaiming(size: number): Buffer {
  const name = Buffer.from("xl/workbook.xml");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(local.length + name.length, 16);
  return Buffer.concat([local, name, central, name, end]);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(64)]);
const ATTACKS: Array<[string, Buffer, string]> = [
  ["an image renamed to .xlsx", PNG, "statement.xlsx"],
  ["an empty file", Buffer.alloc(0), "statement.csv"],
  ["a zip bomb", zipClaiming(0xfffffff0), "statement.xlsx"],
  ["an executable renamed to .pdf", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200)]), "statement.pdf"],
];

const SITES: Array<{ name: string; path: () => string; fields?: Record<string, string> }> = [
  { name: "bank statement", path: () => `/api/bank/accounts/${accountId}/import` },
  { name: "credit import", path: () => "/api/credit/imports" },
  { name: "import session", path: () => "/api/imports/sessions", fields: { answers: "{}" } },
  { name: "detect", path: () => "/api/imports/detect" },
  { name: "smart import", path: () => "/api/imports/smart" },
  { name: "expenses import", path: () => "/api/imports/expenses" },
  { name: "loan schedule", path: () => "/api/loans/schedule/import" },
];

function post(site: (typeof SITES)[number], file: Buffer, name: string) {
  const req = request(app).post(site.path()).set(headers());
  for (const [key, value] of Object.entries(site.fields ?? {})) req.field(key, value);
  return req.attach("file", file, name);
}

describe("every upload route checks what the file really is", () => {
  describe.each(SITES)("$name", (site) => {
    it.each(ATTACKS)("refuses %s before any parser or record sees it", async (_label, bytes, name) => {
      const res = await post(site, bytes, name);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/^הקובץ אינו /);
      expect(await prisma.importSession.count({ where: { userId } })).toBe(0);
      expect(await prisma.bankStatementImport.count({ where: { userId } })).toBe(0);
    });

    it("refuses a file over 10 MB with 413, not a server error", async () => {
      const res = await post(site, Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41), "statement.csv");
      expect(res.status).toBe(413);
    });
  });
});

describe("real files keep passing", () => {
  const dir = path.resolve(__dirname, "../../tests/fixtures");
  const files = readdirSync(dir).filter((name) => /\.(pdf|xlsx|xls|csv)$/i.test(name));

  it.skipIf(files.length === 0).each(files)("%s is recognised by its bytes", (name) => {
    const expected = name.toLowerCase().endsWith(".pdf") ? "pdf" : name.toLowerCase().endsWith(".csv") ? "text" : ["zip", "ole", "text"];
    const kind = fileKind(readFileSync(path.join(dir, name)));
    if (Array.isArray(expected)) expect(expected).toContain(kind);
    else expect(kind).toBe(expected);
  });

  it("a Hebrew CSV in windows-1255 and in UTF-8 is text", () => {
    expect(fileKind(Buffer.from([0xfa, 0xe0, 0xf8, 0xe9, 0xea, 0x2c, 0xf1, 0xea, 0xed, 0x0a]))).toBe("text");
    expect(fileKind(Buffer.from("תאריך,סכום\n2026-10-01,100\n"))).toBe("text");
  });
});
