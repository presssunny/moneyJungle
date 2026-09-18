import type { Request, Response } from "express";
import { ApiError } from "../../utils/ApiError";
import { importSessions } from "./importSession.service";
export async function stageLegacyImport(req:Request,res:Response,answers:unknown) {
  if(!req.file) throw ApiError.badRequest("יש לצרף קובץ");
  const session=await importSessions.create(req.userId!,Buffer.from(req.file.originalname,"latin1").toString("utf8"),req.file.buffer,answers);
  const reviewUrl=`/imports?session=${session.id}`;
  res.setHeader("Location",reviewUrl);
  res.status(202).json({...session,sessionId:session.id,reviewUrl,requiresReview:true});
}
