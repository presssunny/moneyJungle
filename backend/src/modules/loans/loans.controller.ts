import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam } from "../../utils/validation.utils";
import { loansService } from "./loans.service";
import { CreateLoanBody, UpdateLoanBody } from "./loans.validation";

export const loansController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    res.json(await loansService.list(req.userId!));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateLoanBody;
    res.status(201).json(await loansService.create(req.userId!, body));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateLoanBody;
    res.json(await loansService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await loansService.remove(req.userId!, id);
    res.json({ ok: true });
  }),

  schedule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    res.json(await loansService.schedule(req.userId!, id));
  }),
};
