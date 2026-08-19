import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, validatedParams } from "../../utils/validation.utils";
import { alertsService } from "./alerts.service";

export const alertsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const onlyUnread = req.query.unread === "1" || req.query.unread === "true";
    res.json(await alertsService.list(req.userId!, onlyUnread));
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await alertsService.markRead(req.userId!, id));
  }),

  markAllRead: asyncHandler(async (req: Request, res: Response) => {
    await alertsService.markAllRead(req.userId!);
    res.json({ ok: true });
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await alertsService.remove(req.userId!, id);
    res.json({ ok: true });
  }),
};
