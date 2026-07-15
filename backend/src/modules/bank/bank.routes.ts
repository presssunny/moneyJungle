import { Request, Response, Router } from "express";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema } from "../../utils/validation.utils";
import { bankService } from "./bank.service";
import {
  CreateBankAccountBody,
  CreateBankTransactionBody,
  UpdateBankAccountBody,
  createBankAccountSchema,
  createBankTransactionSchema,
  updateBankAccountSchema,
} from "./bank.validation";

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

bankRoutes.delete(
  "/transactions/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await bankService.removeTransaction(req.userId!, id);
    res.json({ ok: true });
  })
);
