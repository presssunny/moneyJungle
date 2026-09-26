import { Router } from "express";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { rateLimit } from "../../middlewares/rateLimit.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { searchRecords } from "./search.service";

export const searchRoutes = Router();
searchRoutes.use(gateAuth);
searchRoutes.get("/", rateLimit({ windowMs: 60000, max: 120, key: (req) => `user:${req.userId!}` }), asyncHandler(async (req, res) => {
  const query = z.object({ q: z.string().trim().min(2).max(60) }).strict().safeParse(req.query);
  if (!query.success) throw ApiError.badRequest("יש להקליד לפחות שני תווים");
  res.setHeader("Cache-Control", "no-store");
  res.json({ query: query.data.q, groups: await searchRecords(req.userId!, query.data.q) });
}));
