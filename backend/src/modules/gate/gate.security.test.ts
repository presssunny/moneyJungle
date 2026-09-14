import crypto from "crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../../app";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { csrfForSession, sessionCookieName } from "./sessionCookie";

let userId: number;
let cookie: string;
let csrf: string;
const email = `cookie-test-${crypto.randomUUID()}@example.test`;
const origin = "http://localhost:5173";

beforeAll(async () => {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => crypto.scrypt("test-password", salt, 64, (err, value) => err ? reject(err) : resolve(value)));
  const user = await prisma.user.create({ data: { name: "__test_cookie", email, passwordHash: `${salt.toString("hex")}:${key.toString("hex")}` } });
  userId = user.id;
});
afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

async function session(overrides: { expiresAt?: Date; lastSeenAt?: Date } = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.gateSession.create({ data: { userId, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000), ...overrides } });
  return { cookie: `${sessionCookieName}=${token}`, csrf: csrfForSession(token) };
}

describe("cookie session security", () => {
  it("logs in with HttpOnly cookie, exposes no credential, and upgrades the legacy password", async () => {
    const response = await request(app).post("/api/gate/login").set("Origin", origin).send({ email, password: "test-password" });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeUndefined();
    expect(response.body.csrfToken).toMatch(/^[a-f0-9]{64}$/);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Lax");
    cookie = cookies[0].split(";")[0]; csrf = response.body.csrfToken as string;
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash).toMatch(/^scrypt\$131072/);
  });
  it("bootstraps the session but requires CSRF even for legacy reads that refresh records", async () => {
    expect((await request(app).get("/api/gate/session").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).get("/api/credit/wallet").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get("/api/credit/wallet").set("Cookie", cookie).set("X-CSRF-Token", csrf)).status).toBe(200);
  });
  it("rejects foreign origins, missing origins and CSRF from a different session", async () => {
    const other = await session();
    expect((await request(app).post("/api/gate/logout").set("Cookie", cookie).set("X-CSRF-Token", csrf).set("Origin", "https://evil.example")).status).toBe(403);
    expect((await request(app).post("/api/gate/logout").set("Cookie", cookie).set("X-CSRF-Token", csrf)).status).toBe(403);
    expect((await request(app).post("/api/gate/logout").set("Cookie", cookie).set("X-CSRF-Token", other.csrf).set("Origin", origin)).status).toBe(403);
  });
  it("rejects a valid old bearer credential rather than accepting localStorage authentication", async () => {
    expect((await request(app).get("/api/gate/session").set("Authorization", `Bearer ${cookie.split("=")[1]}`)).status).toBe(401);
  });
  it("rejects idle, expired and disabled sessions", async () => {
    const idle = await session({ lastSeenAt: new Date(Date.now() - (env.SESSION_IDLE_MINUTES + 1) * 60000) });
    const expired = await session({ expiresAt: new Date(Date.now() - 1000) });
    expect((await request(app).get("/api/gate/session").set("Cookie", idle.cookie)).status).toBe(401);
    expect((await request(app).get("/api/gate/session").set("Cookie", expired.cookie)).status).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { status: "inactive" } });
    expect((await request(app).get("/api/gate/session").set("Cookie", cookie)).status).toBe(401);
    await prisma.user.update({ where: { id: userId }, data: { status: "active" } });
  });
  it("logs out server-side, clears the cookie and rejects replay", async () => {
    const response = await request(app).post("/api/gate/logout").set("Origin", origin).set("Cookie", cookie).set("X-CSRF-Token", csrf);
    expect(response.status).toBe(200);
    expect(String(response.headers["set-cookie"])).toContain("Expires=Thu, 01 Jan 1970");
    expect((await request(app).get("/api/gate/session").set("Cookie", cookie)).status).toBe(401);
  });
});
