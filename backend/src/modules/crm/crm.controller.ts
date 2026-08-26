import { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, validatedBody, validatedParams } from "../../utils/validation.utils";
import { crmService } from "./crm.service";
import { CreateCustomerBody, UpdateCustomerBody } from "./crm.validation";

export const crmController = {
  listCustomers: asyncHandler(async (_req: Request, res: Response) => {
    res.json(await crmService.listCustomers());
  }),

  getCustomer: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await crmService.getCustomerDetail(id));
  }),

  createCustomer: asyncHandler(async (req: Request, res: Response) => {
    const body = validatedBody<CreateCustomerBody>(req);
    res.status(201).json(await crmService.createCustomer(body));
  }),

  updateCustomer: asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const body = validatedBody<UpdateCustomerBody>(req);
    res.json(await crmService.updateCustomer(id, body, req.userId!));
  }),
};
