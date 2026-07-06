import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam } from "../../utils/validation.utils";
import { remindersService } from "./reminders.service";
import { CreateReminderBody, UpdateReminderBody } from "./reminders.validation";

export const remindersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    res.json(await remindersService.list(req.userId!));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as CreateReminderBody;
    res.status(201).json(await remindersService.create(req.userId!, body));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const body = req.validated?.body as UpdateReminderBody;
    res.json(await remindersService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    await remindersService.remove(req.userId!, id);
    res.json({ ok: true });
  }),
};
