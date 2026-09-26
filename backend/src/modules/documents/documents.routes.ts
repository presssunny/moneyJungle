import { Request, Response, Router } from "express";
import { z } from "zod";
import { gateAuth } from "../../middlewares/gateAuth.middleware";
import { validate } from "../../middlewares/validation.middleware";
import { asyncHandler } from "../../utils/asyncHandler";
import { IdParam, idParamSchema, validatedParams } from "../../utils/validation.utils";
import { documentsService } from "./documents.service";
import { documentBreakdown } from "./documentBreakdown.service";

export const documentsRoutes = Router();

documentsRoutes.use(gateAuth);

/** Every file ever uploaded, newest first, with what came of it. */
documentsRoutes.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await documentsService.list(req.userId!));
  })
);

/**
 * The stored file itself. 404 with a plain reason when the bytes were never kept —
 * everything uploaded before file storage existed is metadata only.
 */
documentsRoutes.get(
  "/:id/file",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const { stream, fileName, contentType } = await documentsService.file(req.userId!, id);
    res.setHeader("Content-Type", contentType);
    // RFC 5987 — the names here are Hebrew, which a bare filename= cannot carry.
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );
    stream.pipe(res);
  })
);

/**
 * What was recognized from the file, row by row — so a preview can show it
 * alongside (or instead of) the raw bytes, before the numbers are trusted.
 */
documentsRoutes.get(
  "/:id/breakdown",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await documentBreakdown(req.userId!, id));
  })
);

documentsRoutes.get(
  "/:id/rows",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    const { page } = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(req.query);
    res.json(await documentsService.rows(req.userId!, id, page));
  })
);

/**
 * Undo the IMPORT: deletes the transactions the file created, keeps the
 * document as a record. Not the same as DELETE below, which only drops the log.
 * Known limit: an edited bank row (e.g. changed category) is indistinguishable
 * from an untouched one — only excluded or loan-linked rows survive.
 */
documentsRoutes.post(
  "/:id/rollback",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    res.json(await documentsService.rollback(req.userId!, id));
  })
);

/** Removes the LOG ENTRY only — the imported transactions stay. */
documentsRoutes.delete(
  "/:id",
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = validatedParams<IdParam>(req);
    await documentsService.remove(req.userId!, id);
    res.json({ ok: true });
  })
);
