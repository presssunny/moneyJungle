import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { bankService } from "./bank.service";
import { reconciliationService } from "./reconciliation.service";
import {
  CreateBankAccountBody,
  CreateBankTransactionBody,
  ReconcileExpenseBody,
  ReconcileIncomeBody,
  ReconcileLoanBody,
  UpdateBankAccountBody,
  createBankAccountSchema,
  createBankTransactionSchema,
  reconcileExpenseSchema,
  reconcileIncomeSchema,
  reconcileLoanSchema,
  updateBankAccountSchema,
} from "./bank.validation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const bankRoutes = Router();

bankRoutes.use(gateAuth);

bankRoutes.get(
  "/accounts",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await bankService.listAccounts(req.userId!));
  })
);

bankRoutes.post(
  "/accounts",
  validate({ body: createBankAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateBankAccountBody;
    res.status(201).json(await bankService.createAccount(req.userId!, body));
  })
);

bankRoutes.patch(
  "/accounts/:id",
  validate({ params: idParamSchema, body: updateBankAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateBankAccountBody;
    res.json(await bankService.updateAccount(req.userId!, id, body));
  })
);

bankRoutes.delete(
  "/accounts/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await bankService.removeAccount(req.userId!, id);
    res.json({ ok: true });
  })
);

bankRoutes.get(
  "/accounts/:id/transactions",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    res.json(await bankService.listTransactions(req.userId!, id));
  })
);

bankRoutes.post(
  "/accounts/:id/transactions",
  validate({ params: idParamSchema, body: createBankTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as CreateBankTransactionBody;
    res.status(201).json(await bankService.createTransaction(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/accounts/:id/import",
  upload.single("file"),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ אקסל או PDF של דף החשבון");
    const { id } = req.validated?.params as IdParam;
    res
      .status(201)
      .json(await bankService.importStatement(req.userId!, id, req.file.buffer, req.file.originalname));
  })
);

bankRoutes.delete(
  "/transactions/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await bankService.removeTransaction(req.userId!, id);
    res.json({ ok: true });
  })
);

// ---------- Reconciliation: surface imported bank rows into the right tabs ----------

bankRoutes.get(
  "/reconciliation",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await reconciliationService.getReconciliation(req.userId!));
  })
);

/**
 * Promote every unambiguous pending row in one pass. Also back-fills statements
 * imported before auto-reconciliation existed, whose rows are still pending and
 * therefore missing from every figure in the app.
 */
bankRoutes.post(
  "/reconciliation/auto",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await reconciliationService.autoReconcile(req.userId!));
  })
);

bankRoutes.post(
  "/reconciliation/:id/income",
  validate({ params: idParamSchema, body: reconcileIncomeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as ReconcileIncomeBody;
    res.status(201).json(await reconciliationService.linkIncome(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/reconciliation/:id/expense",
  validate({ params: idParamSchema, body: reconcileExpenseSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as ReconcileExpenseBody;
    res.status(201).json(await reconciliationService.linkExpense(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/reconciliation/loan",
  validate({ body: reconcileLoanSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as ReconcileLoanBody;
    res.status(201).json(await reconciliationService.linkLoan(req.userId!, body));
  })
);

bankRoutes.post(
  "/reconciliation/:id/exclude",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    res.json(await reconciliationService.exclude(req.userId!, id));
  })
);

bankRoutes.post(
  "/reconciliation/:id/reset",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await reconciliationService.reset(req.userId!, id);
    res.json({ ok: true });
  })
);
