import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodType } from "zod";

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates request parts with zod. Parsed values are stored on req.validated
 * (express 5 makes req.query read-only, so we never reassign it).
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const validated: Record<string, unknown> = {};
    if (schemas.body) validated.body = schemas.body.parse(req.body);
    if (schemas.query) validated.query = schemas.query.parse(req.query);
    if (schemas.params) validated.params = schemas.params.parse(req.params);
    req.validated = validated as Request["validated"];
    next();
  };
}
