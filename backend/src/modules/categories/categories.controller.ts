import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, validatedBody, validatedParams } from "../../utils/validation.utils";
import { categoriesService } from "./categories.service";
import {
  CreateCategoryBody,
  CreateRuleBody,
  UpdateCategoryBody,
  UpdateRuleBody,
} from "./categories.validation";

export const categoriesController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    res.json(await categoriesService.list(req.userId!, type));
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateCategoryBody>(req);
    res.status(201).json(await categoriesService.create(req.userId!, body));
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateCategoryBody>(req);
    res.json(await categoriesService.update(req.userId!, id, body));
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await categoriesService.remove(req.userId!, id);
    res.json({ ok: true });
  }),

  listRules: asyncHandler(async (req: Request, res: Response) => {
    res.json(await categoriesService.listRules(req.userId!));
  }),

  createRule: asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateRuleBody>(req);
    res.status(201).json(await categoriesService.createRule(req.userId!, body));
  }),

  updateRule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateRuleBody>(req);
    res.json(await categoriesService.updateRule(req.userId!, id, body));
  }),

  removeRule: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await categoriesService.removeRule(req.userId!, id);
    res.json({ ok: true });
  }),
};
