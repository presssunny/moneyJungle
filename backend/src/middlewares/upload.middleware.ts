import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import { ApiError } from "../utils/ApiError";

/** What the bytes are, whatever the file name says. */
export type FileKind = "pdf" | "zip" | "ole" | "text";

/** xlsx is a zip, xls an OLE file — or, from some banks, an HTML page saved as .xls. */
export const SPREADSHEET_KINDS: readonly FileKind[] = ["zip", "ole", "text"];
export const STATEMENT_KINDS: readonly FileKind[] = ["pdf", ...SPREADSHEET_KINDS];

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_RATIO = 100;
const UPLOAD_TIMEOUT_MS = 60_000;
const TEXT_SNIFF_BYTES = 8 * 1024;

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_LOCAL = 0x04034b50;
const ZIP_END = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;

const storage = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

/**
 * Total uncompressed size from the central directory, or null when the archive
 * is not a well-formed zip. A zip64 archive (sizes 0xFFFFFFFF) is refused: no
 * statement is anywhere near 4 GB, so it can only be a trick.
 */
function unzippedBytes(buf: Buffer): number | null {
  const searchFrom = Math.max(0, buf.length - 22 - 0xffff);
  let end = -1;
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === ZIP_END) { end = i; break; }
  }
  if (end < 0) return null;
  const entries = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== ZIP_CENTRAL) return null;
    const size = buf.readUInt32LE(offset + 24);
    if (size === 0xffffffff) return null;
    total += size;
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return total;
}

function decodes(bytes: Buffer, encoding: string): boolean {
  try {
    new TextDecoder(encoding, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function fileKind(buf: Buffer): FileKind | null {
  if (buf.length === 0) return null;
  if (buf.subarray(0, 1024).includes("%PDF-")) return "pdf";
  if (buf.length >= 4 && buf.readUInt32LE(0) === ZIP_LOCAL) {
    const total = unzippedBytes(buf);
    return total !== null && total <= MAX_UNZIPPED_BYTES && total <= buf.length * MAX_ZIP_RATIO ? "zip" : null;
  }
  if (buf.subarray(0, 8).equals(OLE_MAGIC)) return "ole";
  // CSV and HTML-as-xls have no magic number: text with no NUL byte. The sniff
  // may cut a UTF-8 character in two, so only the whole prefix minus 3 bytes is decoded.
  const head = buf.subarray(0, TEXT_SNIFF_BYTES);
  if (head.includes(0)) return null;
  const sample = buf.length > TEXT_SNIFF_BYTES ? head.subarray(0, TEXT_SNIFF_BYTES - 3) : head;
  return decodes(sample, "utf-8") || decodes(sample, "windows-1255") ? "text" : null;
}

const KIND_LABEL: Record<FileKind, string> = { pdf: "PDF", zip: "Excel", ole: "Excel", text: "CSV" };

function describe(kinds: readonly FileKind[]): string {
  return [...new Set(kinds.map((kind) => KIND_LABEL[kind]))].join(", ");
}

/**
 * The single file upload for every route that takes a statement: one multer
 * config, a time limit on receiving it, and a check of the bytes after multer has
 * read them — multer's fileFilter only ever sees the name and the browser's type.
 */
export function uploadFile(kinds: readonly FileKind[]): RequestHandler[] {
  // The limit covers receiving the bytes only; parsing a long statement afterwards may take longer.
  const read: RequestHandler = (req, res, next) => {
    req.setTimeout(UPLOAD_TIMEOUT_MS);
    storage.single("file")(req, res, (err: unknown) => {
      req.setTimeout(0);
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return next(new ApiError(413, "הקובץ גדול מ־10MB"));
      }
      if (err instanceof multer.MulterError) return next(ApiError.badRequest("לא הצלחנו לקרוא את הקובץ שצורף"));
      next(err);
    });
  };
  const check = (req: Request, _res: Response, next: NextFunction) => {
    if (!req.file) return next();
    const kind = fileKind(req.file.buffer);
    if (kind === null || !kinds.includes(kind)) {
      return next(ApiError.badRequest(`הקובץ אינו ${describe(kinds)} תקין — אולי שם הקובץ שונה או שהוא פגום.`));
    }
    next();
  };
  return [read, check];
}
