import { Request, Response, Router } from "express";
import multer from "multer";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedBody, validatedParams } from "../../utils/validation.utils";
import { accountBalanceService } from "./accountBalance.service";
import { bankService } from "./bank.service";
import { reconciliationService } from "./reconciliation.service";
import {
  CreateBankAccountBody,
  CreateBankTransactionBody,
  ReconcileExpenseBody,
  ReconcileIncomeBody,
  ReconcileLoanBody,
  SetAnchorBody,
  UpdateBankAccountBody,
  createBankAccountSchema,
  createBankTransactionSchema,
  reconcileExpenseSchema,
  reconcileIncomeSchema,
  reconcileLoanSchema,
  setAnchorSchema,
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

/** Statements taken in for an account: period covered and printed balances. */
bankRoutes.get(
  "/accounts/:id/statements",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await bankService.listStatements(req.userId!, id));
  })
);

/**
 * State the balance the bank shows as of a date. Anchors the account when the
 * statement files carry no printed balance column.
 */
bankRoutes.post(
  "/accounts/:id/anchor",
  validate({ params: idParamSchema, body: setAnchorSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<SetAnchorBody>(req);
    res.json(await bankService.setAnchor(req.userId!, id, body.balance, body.asOf));
  })
);

/** Recompute the balance from scratch — safe to call at any time. */
bankRoutes.post(
  "/accounts/:id/recompute",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await accountBalanceService.recompute(req.userId!, id));
  })
);

bankRoutes.post(
  "/accounts",
  validate({ body: createBankAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateBankAccountBody>(req);
    res.status(201).json(await bankService.createAccount(req.userId!, body));
  })
);

bankRoutes.patch(
  "/accounts/:id",
  validate({ params: idParamSchema, body: updateBankAccountSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateBankAccountBody>(req);
    res.json(await bankService.updateAccount(req.userId!, id, body));
  })
);

bankRoutes.delete(
  "/accounts/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await bankService.removeAccount(req.userId!, id);
    res.json({ ok: true });
  })
);

bankRoutes.get(
  "/accounts/:id/transactions",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await bankService.listTransactions(req.userId!, id));
  })
);

bankRoutes.post(
  "/accounts/:id/transactions",
  validate({ params: idParamSchema, body: createBankTransactionSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<CreateBankTransactionBody>(req);
    res.status(201).json(await bankService.createTransaction(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/accounts/:id/import",
  upload.single("file"),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("יש לצרף קובץ אקסל או PDF של דף החשבון");
    const { id } = validatedParams<IdParam>(req);
    res
      .status(201)
      .json(await bankService.importStatement(req.userId!, id, req.file.buffer, req.file.originalname));
  })
);

bankRoutes.delete(
  "/transactions/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
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
 * Give every imported bank row a financial meaning in one pass, and make the
 * records in the other tabs agree with it. Also back-fills statements imported
 * before the resolver existed, whose rows are still pending and therefore missing
 * from every figure in the app.
 */
bankRoutes.post(
  "/reconciliation/auto",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await reconciliationService.resolveAll(req.userId!));
  })
);

/**
 * Loan activity exactly as the statement reports it: principal, interest and
 * combined payments per loan reference, plus loans received. Derived from
 * `bank_transactions`, so it can never drift from the reconciliation screen.
 */
bankRoutes.get(
  "/reconciliation/loans",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await reconciliationService.loanActivityFromStatement(req.userId!));
  })
);

bankRoutes.post(
  "/reconciliation/:id/income",
  validate({ params: idParamSchema, body: reconcileIncomeSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<ReconcileIncomeBody>(req);
    res.status(201).json(await reconciliationService.linkIncome(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/reconciliation/:id/expense",
  validate({ params: idParamSchema, body: reconcileExpenseSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<ReconcileExpenseBody>(req);
    res.status(201).json(await reconciliationService.linkExpense(req.userId!, id, body));
  })
);

bankRoutes.post(
  "/reconciliation/loan",
  validate({ body: reconcileLoanSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<ReconcileLoanBody>(req);
    res.status(201).json(await reconciliationService.linkLoan(req.userId!, body));
  })
);

bankRoutes.post(
  "/reconciliation/:id/exclude",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await reconciliationService.exclude(req.userId!, id));
  })
);

bankRoutes.post(
  "/reconciliation/:id/reset",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await reconciliationService.reset(req.userId!, id);
    res.json({ ok: true });
  })
);
