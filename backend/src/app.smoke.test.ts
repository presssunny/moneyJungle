/**
 * End-to-end smoke over the real Express app. Runs without a database on purpose
 * — health, 404/401 shapes, validation and the login throttle are all decided
 * before any query — so it stays runnable anywhere while still proving the app
 * boots with every route and middleware loaded.
 *
 * The DB-backed round trip at the bottom skips itself when MariaDB is not up.
 */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "./app";
import { prisma } from "./config/database";

/** Routes that must refuse an unauthenticated caller. One per risk area. */
const PROTECTED = [
  "/api/dashboard",
  "/api/expenses",
  "/api/incomes",
  "/api/loans",
  "/api/bank/accounts",
  "/api/credit",
  "/api/settings",
  "/api/family",
  "/api/reports/monthly",
  "/api/imports",
];

describe("GET /api/health", () => {
  it("עונה 200 — האפליקציה נטענה על כל המודולים", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "monthly-finance-planner" });
  });

  it("מחזיר את כותרות האבטחה ולא חושף את שרת היישום", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("צורת השגיאה אחידה בכל המערכת", () => {
  it("נתיב לא קיים → 404 בפורמט { error: { message } }", async () => {
    const res = await request(app).get("/api/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body.error?.message).toBeTypeOf("string");
    expect(res.body.error.message.length).toBeGreaterThan(0);
  });

  it("גוף לא תקין → 400 עם details לכל שדה", async () => {
    const res = await request(app).post("/api/gate/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeTypeOf("string");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details[0]).toHaveProperty("path");
    expect(res.body.error.details[0]).toHaveProperty("message");
  });

  it("כל תשובת שגיאה עטופה ב־error — אף מסלול לא מחזיר פורמט אחר", async () => {
    const responses = await Promise.all([
      request(app).get("/api/no-such-route"),
      request(app).get("/api/dashboard"),
      request(app).post("/api/gate/login").send({}),
    ]);
    for (const res of responses) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(Object.keys(res.body)).toEqual(["error"]);
      expect(res.body.error).toHaveProperty("message");
    }
  });
});

describe("שער הכניסה — אף מסלול אינו פתוח בלי טוקן", () => {
  for (const route of PROTECTED) {
    it(`GET ${route} → 401 בלי טוקן`, async () => {
      const res = await request(app).get(route);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBeTypeOf("string");
    });
  }

  it("טוקן שגוי נדחה ואינו נחשב כמאומת", async () => {
    const res = await request(app).get("/api/gate/session").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("כותרת Authorization בפורמט שגוי אינה עוקפת את השער", async () => {
    for (const header of ["", "Basic abc", "bearer lowercase", "Bearer"]) {
      const res = await request(app).get("/api/dashboard").set("Authorization", header);
      expect(res.status).toBe(401);
    }
  });
});

/**
 * Last on purpose: the throttle counts every request to the login route from the
 * start of the process, so an earlier test's login attempt is already in the
 * bucket. Runs with an invalid body, so nothing here reaches the database.
 */
describe("חסימת ניסיונות התחברות", () => {
  it("חוסם ב־429 אחרי יותר מדי ניסיונות מאותו מקור", async () => {
    let sawTooMany = false;
    for (let attempt = 0; attempt < 20 && !sawTooMany; attempt += 1) {
      const res = await request(app).post("/api/gate/login").send({ password: "wrong-on-purpose" });
      if (res.status === 429) {
        expect(res.body.error.message).toBeTypeOf("string");
        sawTooMany = true;
      }
    }
    expect(sawTooMany).toBe(true);
  });
});

/**
 * The only part that needs MariaDB. Skips rather than fails when it is down, so
 * the suite stays runnable — a green run without the DB is therefore not proof
 * that login works end to end.
 */
describe("מסלול מלא מול בסיס הנתונים", () => {
  let dbUp = false;

  beforeAll(async () => {
    try {
      await prisma.user.findFirst();
      dbUp = true;
    } catch {
      dbUp = false;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

  it("סיסמה שגויה נדחית ב־401", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const res = await request(app)
      .post("/api/gate/login")
      .set("X-Forwarded-For", "10.10.10.1") // fresh throttle bucket
      .send({ username: "definitely-not-a-user", password: "definitely-wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBeTypeOf("string");
  });

  /**
   * A wrong username and a wrong password must be indistinguishable, or the
   * login screen becomes a way to learn who the account belongs to.
   */
  it("שם משתמש שגוי וסיסמה שגויה מחזירים בדיוק אותה תשובה", async ({ skip }) => {
    if (!dbUp) skip("MariaDB אינו זמין — יש להריץ bash backend/start-db.sh");
    const [badUser, badPassword] = await Promise.all([
      request(app)
        .post("/api/gate/login")
        .set("X-Forwarded-For", "10.10.10.2")
        .send({ username: "definitely-not-a-user", password: "definitely-wrong" }),
      request(app)
        .post("/api/gate/login")
        .set("X-Forwarded-For", "10.10.10.3")
        .send({ username: "REDACTED_USERNAME", password: "definitely-wrong" }),
    ]);
    expect(badUser.status).toBe(badPassword.status);
    expect(badUser.body).toEqual(badPassword.body);
  });
});
