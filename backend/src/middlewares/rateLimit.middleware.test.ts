import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { rateLimit } from "./rateLimit.middleware";
import { errorMiddleware } from "./error.middleware";

afterEach(() => vi.restoreAllMocks());
it("does not trust spoofed forwarding headers and recovers after the limit window", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100000);
  const app = express();
  app.use(rateLimit({ windowMs: 1000, max: 1 }));
  app.get("/", (_req, res) => res.json({ ok: true }));
  app.use(errorMiddleware);
  expect((await request(app).get("/").set("X-Forwarded-For", "1.1.1.1")).status).toBe(200);
  const blocked = await request(app).get("/").set("X-Forwarded-For", "2.2.2.2");
  expect(blocked.status).toBe(429);
  expect(blocked.headers["retry-after"]).toBe("1");
  now.mockReturnValue(101001);
  expect((await request(app).get("/")).status).toBe(200);
});
