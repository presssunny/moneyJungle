import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { extractBearerToken } from "../../middlewares/gateAuth.middleware";
import { gateService } from "./gate.service";
import { LoginBody } from "./gate.validation";

export const gateController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { password } = req.validated?.body as LoginBody;
    const result = await gateService.login(password);
    res.json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) await gateService.logout(token);
    res.json({ ok: true });
  }),

  // Reached only when gateAuth passed, so the session is valid.
  session: asyncHandler(async (_req: Request, res: Response) => {
    res.json({ authenticated: true });
  }),
};
