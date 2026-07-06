import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { settingsService } from "./settings.service";
import { UpdateSettingsBody } from "./settings.validation";

export const settingsController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    res.json(await settingsService.get(req.userId!));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const body = req.validated?.body as UpdateSettingsBody;
    res.json(await settingsService.update(req.userId!, body));
  }),
};
