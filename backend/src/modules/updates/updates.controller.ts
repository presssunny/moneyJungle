import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { updatesService } from "./updates.service";

export const updatesController = {
  ticker: asyncHandler(async (req: Request, res: Response) => {
    res.json(await updatesService.ticker(req.userId!));
  }),
};
