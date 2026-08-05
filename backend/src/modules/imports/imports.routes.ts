import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { readAnswers } from "../assistant/assistant.types";
import { MonthQuery, monthQuerySchema, resolveMonth } from "../../utils/validation.utils";
import { importsService } from "./imports.service";
import { smartImportService } from "./smartImport.service";
import { detectStatement, type StatementKind } from "./statementDetector.service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const importsRoutes = Router();

importsRoutes.use(gateAuth);

const FORCED_KINDS: readonly StatementKind[] = ["bank", "credit"];

function readForcedKind(value: unknown): StatementKind | undefined {
  return FORCED_KINDS.find((kind) => kind === value);
}

/**
 * Look at a file and say what it is, without importing anything. Lets the UI
 * show the user what will happen before she commits to it.
 */
importsRoutes.post(
  "/detect",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ");
    const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const detection = detectStatement(req.file.buffer, fileName);
    res.json({ ...detection, fileName });
  })
);

/**
 * Import a statement of either kind. When the app cannot tell, it asks instead of
 * failing: `assistant.questions` comes back, nothing is imported, and the client
 * re-sends the SAME file with `answers` — hence no server-side upload buffer.
 * 200 = a pending question, 201 = data actually written.
 */
importsRoutes.post(
  "/smart",
  upload.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ אקסל או PDF");
    const fileName = Buffer.from(req.file.originalname, "latin1").toString("utf8");
    const result = await smartImportService.importFile(
      req.userId!,
      fileName,
      req.file.buffer,
      readForcedKind(req.body?.kind),
      readAnswers(req.body?.answers)
    );
    res.status(result.assistant.status === "needs_answers" ? 200 : 201).json(result);
  })
);

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
