import { Router } from "express";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { listActivity } from "./activity.service";

export const activityRoutes = Router();
activityRoutes.use(gateAuth);
activityRoutes.get("/", asyncHandler(async (req, res) => {
  const query = z.object({ before: z.coerce.number().int().positive().optional() }).strict().safeParse(req.query);
  if (!query.success) throw ApiError.badRequest("בקשת יומן לא תקינה");
  res.setHeader("Cache-Control", "no-store");
  res.json(await listActivity(req.userId!, query.data.before));
}));
