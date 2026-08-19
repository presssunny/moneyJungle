import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { validatedBody } from "../../utils/validation.utils";
import { settingsService } from "./settings.service";
import { UpdateSettingsBody } from "./settings.validation";

export const settingsController = {
  get: asyncHandler(async (req: Request, res: Response) => {
    res.json(await settingsService.get(req.userId!));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<UpdateSettingsBody>(req);
    res.json(await settingsService.update(req.userId!, body));
  }),
};
