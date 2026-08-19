import { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, validatedBody, validatedParams } from "../../utils/validation.utils";
import { loanScheduleService } from "./loanSchedule.service";
import { loansService } from "./loans.service";
import { CloseLoanBody, CreateLoanBody, UpdateLoanBody } from "./loans.validation";

export const loansController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    res.json(await loansService.list(req.userId!));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateLoanBody>(req);
    res.status(201).json(await loansService.create(req.userId!, body));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateLoanBody>(req);
    res.json(await loansService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await loansService.remove(req.userId!, id);
    res.json({ ok: true });
  }),

  /** The bank's own amortisation table when it exists, a marked simulation otherwise. */
  schedule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await loanScheduleService.getSchedule(req.userId!, id));
  }),

  /**
   * Upload a לוח סילוקין. Creates the loan or updates the matching one, and
   * fills in balance, rate, payment, counts and dates from the file — so the user
   * never types what the bank already stated.
   */
  importSchedule: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest("לא נבחר קובץ");
    const loanId = req.body?.loanId ? Number(req.body.loanId) : undefined;
    res.json(
      await loanScheduleService.importSchedule(
        req.userId!,
        req.file.buffer,
        Number.isFinite(loanId) ? loanId : undefined
      )
    );
  }),

  close: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<CloseLoanBody>(req);
    res.json(await loansService.close(req.userId!, id, body));
  }),

  earlyRepayment: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await loansService.earlyRepaymentQuote(req.userId!, id));
  }),
};
