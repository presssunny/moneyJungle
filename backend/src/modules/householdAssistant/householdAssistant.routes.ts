import { Router } from "express";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { rateLimit } from "../../middlewares/rateLimit.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { householdSnapshot } from "./householdAssistant.service";
import { prioritizePlan } from "./plan.service";
import { askQuestion } from "./ask.service";
import { aiAvailable, getAiProvider } from "../ai/ai.service";
import { decideDuplicate, duplicateDetail, duplicateHistory, duplicateReviewInput, undoDuplicate } from "./duplicateReview.service";

export const householdAssistantRoutes = Router();
householdAssistantRoutes.use(gateAuth);
householdAssistantRoutes.get("/duplicates/:id", asyncHandler(async (req, res) => {
  const id = z.string().regex(/^duplicate:[a-f0-9]{24}$/).safeParse(req.params.id);
  if (!id.success) throw ApiError.badRequest("מזהה בדיקה לא תקין.");
  res.setHeader("Cache-Control", "no-store");
  res.json(await duplicateDetail(req.userId!, id.data));
}));
householdAssistantRoutes.get("/duplicate-reviews", asyncHandler(async (req, res) => {
  const query = z.object({ cursor: z.uuid().optional(), followUp: z.enum(["true", "false"]).optional() }).strict().safeParse(req.query);
  if (!query.success) throw ApiError.badRequest("בקשת היסטוריה לא תקינה.");
  res.setHeader("Cache-Control", "no-store");
  res.json(await duplicateHistory(req.userId!, query.data.cursor, query.data.followUp === "true"));
}));
householdAssistantRoutes.post("/duplicate-reviews", asyncHandler(async (req, res) => {
  const input = duplicateReviewInput.safeParse(req.body);
  if (!input.success) throw ApiError.badRequest("יש לבחור החלטה ולאשר את השפעתה על הרישומים.");
  res.json(await decideDuplicate(req.userId!, input.data));
}));
householdAssistantRoutes.post("/duplicate-reviews/:id/undo", asyncHandler(async (req, res) => {
  const input = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) }).strict().safeParse(req.body);
  const id = z.uuid().safeParse(req.params.id);
  if (!input.success || !id.success) throw ApiError.badRequest("יש לאשר ביטול של החלטה עדכנית.");
  res.json(await undoDuplicate(req.userId!, id.data, input.data.version));
}));
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
// Read-only: a question never writes, so it is left out of the activity log and mutation refresh.
householdAssistantRoutes.post("/ask", rateLimit({ windowMs: 60000, max: 10, key: req => `user:${req.userId!}` }), asyncHandler(async (req, res) => {
  const parsed = z.object({
    question: z.string().trim().min(2).max(300), consent: z.boolean(), documentId: z.number().int().positive().optional(),
  }).strict().safeParse(req.body);
  if (!parsed.success) throw ApiError.badRequest("יש להקליד שאלה קצרה.");
  res.setHeader("Cache-Control", "no-store");
  res.json(await askQuestion(req.userId!, parsed.data, aiAvailable() ? getAiProvider() : null));
}));
