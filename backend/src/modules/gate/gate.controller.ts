import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { extractBearerToken } from "../../middlewares/gateAuth.middleware";
import { validatedBody } from "../../utils/validation.utils";
import { gateService } from "./gate.service";
import { LoginBody } from "./gate.validation";

export const gateController = {
  login: asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = validatedBody<LoginBody>(req);
    const result = await gateService.login(username, password);
    res.json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (token) await gateService.logout(token);
    res.json({ ok: true });
  }),

  // Reached only when gateAuth passed, so the session is valid. `user` is added
  // for the UI to greet by name; `authenticated` is kept so older clients that
  // only look at that field keep working.
  session: asyncHandler(async (_req: Request, res: Response) => {
    res.json({ authenticated: true, user: gateService.identity() });
  }),
};
