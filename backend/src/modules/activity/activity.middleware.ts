import type { NextFunction, Request, Response } from "express";
import { describeMutation, recordActivity } from "./activity.service";

/**
 * Records a successful mutation after the response is sent. The owner comes from
 * gateAuth, which runs later inside each router but on this same request object.
 * A failed write is logged and never turns a completed change into an error.
 */
export function activityRecorder(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  let responseBody: unknown;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    responseBody = body;
    return json(body);
  };
  res.on("finish", () => {
    if (!req.userId || res.statusCode < 200 || res.statusCode >= 300) return;
    const description = describeMutation(req.method, req.originalUrl.replace(/^\/api/, "").split("?")[0], req.body, responseBody);
    if (!description) return;
    recordActivity(req.userId, description).catch((error: unknown) => console.error("activity log write failed", error));
  });
  next();
}
