import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { stageLegacyImport } from "../imports/legacyImportAdapter";
import { creditService } from "./credit.service";
import { z } from "zod";
import { walletService } from "./wallet.service";
import { monthQuerySchema, resolveMonth, validatedQuery, type MonthQuery } from "../../utils/validation.utils";
import {
  UpdateCreditTransactionBody,
  UploadImportBody,
  updateCreditTransactionSchema,
  uploadImportSchema,
} from "./credit.validation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const creditRoutes = Router();

creditRoutes.use(gateAuth);

const cardSchema = z.object({ name: z.string().trim().min(1).max(80), issuer: z.string().trim().min(1).max(80),
  lastFour: z.string().regex(/^\d{4}$/), billingDay: z.number().int().min(1).max(31).nullable().optional() });
const assignmentSchema = z.object({ cardId: z.number().int().positive().nullable() });

creditRoutes.get("/wallet", validate({ query: monthQuerySchema }), asyncHandler(async (req, res) => {
  const { year, month } = resolveMonth(validatedQuery<MonthQuery>(req));
  res.json(await walletService.list(req.userId!, year, month));
}));
creditRoutes.get("/cards", asyncHandler(async (req, res) => {
  res.json(await walletService.cards(req.userId!));
}));
creditRoutes.post("/cards", validate({ body: cardSchema }), asyncHandler(async (req, res) => {
  res.status(201).json(await walletService.create(req.userId!, validatedBody<z.infer<typeof cardSchema>>(req)));
}));
creditRoutes.patch("/cards/:id", validate({ params: idParamSchema, body: cardSchema }), asyncHandler(async (req, res) => {
  res.json(await walletService.update(req.userId!, validatedParams<IdParam>(req).id, validatedBody<z.infer<typeof cardSchema>>(req)));
}));
creditRoutes.patch("/imports/:id/card", validate({ params: idParamSchema, body: assignmentSchema }), asyncHandler(async (req, res) => {
  res.json(await walletService.assign(req.userId!, validatedParams<IdParam>(req).id, validatedBody<z.infer<typeof assignmentSchema>>(req).cardId));
}));
creditRoutes.patch("/transactions/:id/card", validate({ params: idParamSchema, body: assignmentSchema }), asyncHandler(async (req, res) => {
  res.json(await walletService.assignTransaction(req.userId!, validatedParams<IdParam>(req).id, validatedBody<z.infer<typeof assignmentSchema>>(req).cardId));
}));

creditRoutes.get(
  "/imports",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await creditService.listImports(req.userId!));
  })
);

creditRoutes.post(
  "/imports",
  upload.single("file"),
  validate({ body: uploadImportSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ אקסל");
    const body = validatedBody<UploadImportBody>(req);
    await stageLegacyImport(req,res,{kind:"credit",...(body.cardId?{cardId:body.cardId}:{})});
  })
);

creditRoutes.get(
  "/imports/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await creditService.getImport(req.userId!, id));
  })
);

creditRoutes.patch(
  "/imports/:id/confirm",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await creditService.confirmImport(req.userId!, id));
  })
);

creditRoutes.delete(
  "/imports/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await creditService.removeImport(req.userId!, id);
    res.json({ ok: true });
  })
);

creditRoutes.post(
  "/recategorize",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await creditService.recategorize(req.userId!));
  })
);

creditRoutes.patch(
  "/transactions/:id",
  validate({ params: idParamSchema, body: updateCreditTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const { categoryId } = validatedBody<UpdateCreditTransactionBody>(req);
    res.json(await creditService.updateTransaction(req.userId!, id, categoryId));
  })
);
