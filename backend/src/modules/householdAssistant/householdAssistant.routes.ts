import { Router } from "express";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { rateLimit } from "../../middlewares/rateLimit.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { getAiProvider } from "../ai/ai.service";
import { householdSnapshot } from "./householdAssistant.service";
import { prioritizePlan } from "./plan.service";

export const householdAssistantRoutes = Router();
householdAssistantRoutes.use(gateAuth);
householdAssistantRoutes.get("/", rateLimit({ windowMs: 60000, max: 30, key: req => `user:${req.userId!}` }), asyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await householdSnapshot(req.userId!));
}));
householdAssistantRoutes.post("/plan", rateLimit({ windowMs: 60000, max: 5, key: req => `user:${req.userId!}` }), asyncHandler(async (req, res) => {
  const parsed = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict().safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest("נדרש אישור לשיתוף המידע המצומצם ובדיקה עדכנית.");
  const snapshot = await householdSnapshot(req.userId!);
  if (snapshot.version !== parsed.data.version) throw ApiError.conflict("הנתונים השתנו. יש לרענן את הבדיקה לפני הפעלת העוזר.");
  const plan = snapshot.aiAvailable
    ? await prioritizePlan(req.userId!, snapshot, getAiProvider())
    : { version: snapshot.version, mode: "rules" as const, actionIds: snapshot.actions.slice(0, 3).map(a => a.id) };
  if (snapshot.aiAvailable && (await householdSnapshot(req.userId!)).version !== snapshot.version) {
    res.json({ version: snapshot.version, mode: "stale", actionIds: [] });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(plan);
}));
