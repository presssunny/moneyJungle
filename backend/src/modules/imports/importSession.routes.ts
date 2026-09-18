import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { importRows } from "./importRows.service";
import { importSessions } from "./importSession.service";
export const importSessionRoutes=Router();
importSessionRoutes.use(gateAuth);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024}});
const id=(value:unknown)=>z.string().uuid().parse(value);
importSessionRoutes.get("/",asyncHandler(async(req,res)=>{res.json(await importSessions.list(req.userId!));}));
importSessionRoutes.post("/",upload.single("file"),asyncHandler(async(req,res)=>{
  if(!req.file) throw ApiError.badRequest("יש לצרף קובץ");
  let answers:unknown={}; try { answers=JSON.parse(req.body.answers??"{}"); } catch { throw ApiError.badRequest("פרטי הקליטה אינם תקינים"); }
  res.status(201).json(await importSessions.create(req.userId!,Buffer.from(req.file.originalname,"latin1").toString("utf8"),req.file.buffer,answers));
}));
importSessionRoutes.get("/:id",asyncHandler(async(req,res)=>{res.json(await importSessions.get(req.userId!,id(req.params.id)));}));
importSessionRoutes.patch("/:id/answers",asyncHandler(async(req,res)=>{const body=z.object({version:z.number().int().nonnegative(),answers:z.unknown()}).parse(req.body);res.json(await importSessions.answer(req.userId!,id(req.params.id),body.version,body.answers));}));
importSessionRoutes.post("/:id/commit",asyncHandler(async(req,res)=>{res.json(await importSessions.commit(req.userId!,id(req.params.id),z.number().int().nonnegative().parse(req.body.version)));}));
importSessionRoutes.post("/:id/complete",asyncHandler(async(req,res)=>{res.json(await importSessions.finish(req.userId!,id(req.params.id)));}));
importSessionRoutes.post("/:id/cancel",asyncHandler(async(req,res)=>{res.json(await importSessions.cancel(req.userId!,id(req.params.id)));}));

importSessionRoutes.get("/:id/rows",asyncHandler(async(req,res)=>{res.json(await importRows.list(req.userId!,id(req.params.id),z.coerce.number().int().min(1).default(1).parse(req.query.page)));}));
importSessionRoutes.patch("/:id/rows/:row",asyncHandler(async(req,res)=>{res.json(await importRows.edit(req.userId!,id(req.params.id),z.coerce.number().int().positive().parse(req.params.row),req.body));}));
