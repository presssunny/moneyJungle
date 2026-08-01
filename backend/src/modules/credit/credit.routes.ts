import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { creditService } from "./credit.service";
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
    const body = req.validated?.body as UploadImportBody;
    const result = await creditService.createImport(
      req.userId!,
      Buffer.from(req.file.originalname, "latin1").toString("utf8"),
      req.file.buffer,
      body
    );
    res.status(201).json(result);
  })
);

creditRoutes.get(
  "/imports/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    res.json(await creditService.getImport(req.userId!, id));
  })
);

creditRoutes.patch(
  "/imports/:id/confirm",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    res.json(await creditService.confirmImport(req.userId!, id));
  })
);

creditRoutes.delete(
  "/imports/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
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
    const { id } = req.validated?.params as IdParam;
    const { categoryId } = req.validated?.body as UpdateCreditTransactionBody;
    res.json(await creditService.updateTransaction(req.userId!, id, categoryId));
  })
);
