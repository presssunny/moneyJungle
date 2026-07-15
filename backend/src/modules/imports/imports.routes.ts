import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { MonthQuery, monthQuerySchema, resolveMonth } from "../../utils/validation.utils";
import { importsService } from "./imports.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const importsRoutes = Router();

importsRoutes.use(gateAuth);

importsRoutes.post(
  "/expenses",
  upload.single("file"),
  validate({ body: monthQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ אקסל");
    const { year, month } = resolveMonth((req.validated?.body ?? {}) as MonthQuery);
    res.status(201).json(await importsService.importExpenses(req.userId!, req.file.buffer, year, month));
  })
);
