import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { extractBearerToken } from "../../middlewares/gateAuth.middleware";
import { validatedBody } from "../../utils/validation.utils";
import { gateService } from "./gate.service";
import { LoginBody } from "./gate.validation";

export const gateController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = validatedBody<LoginBody>(req);
    const result = await gateService.login(email, password);
    res.json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) await gateService.logout(token);
    res.json({ ok: true });
  }),

  // Reached only when gateAuth passed, so req.userId/.../.userRole are already
  // the real, resolved identity — no second DB round trip needed here.
  // `authenticated` is kept so older clients that only look at that field
  // keep working.
  session: asyncHandler(async (req: Request, res: Response) => {
    res.json({
      authenticated: true,
      user: {
        id: req.userId,
        email: req.userEmail,
        displayName: req.userDisplayName,
        role: req.userRole,
      },
    });
  }),
};
