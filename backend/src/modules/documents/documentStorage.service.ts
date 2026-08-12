import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";

/**
 * The uploaded bytes on disk. Local storage only — no bucket, no third party
 * (CLAUDE.md §7). `backend/storage/` is git-ignored: real statements.
 */

/** Absolute, so a relative default resolves against the backend dir, not the cwd. */
function rootDir(): string {
  return path.resolve(process.cwd(), env.DOCUMENT_STORAGE_DIR);
}

/** Strips path separators and leading dots; the hash prefix guarantees uniqueness. */
function safeName(fileName: string): string {
  const base = path.basename(fileName).replace(/[/\\]/g, "_").replace(/^\.+/, "");
  const trimmed = base.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : "file";
}

export const documentStorage = {
  /**
   * Writes the bytes, returns a path relative to the storage root (which moves
   * between machines). Returns null on failure — never fails the import itself.
   */
  async save(
    userId: number,
    fileHash: string,
    fileName: string,
    buffer: Buffer
  ): Promise<string | null> {
    const relativePath = path.posix.join(String(userId), `${fileHash}-${safeName(fileName)}`);
    try {
      const absolute = path.join(rootDir(), relativePath);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, buffer);
      return relativePath;
    } catch (error) {
      console.warn("[מרכז מסמכים] לא הצלחנו לשמור את הקובץ בדיסק — הייבוא עצמו הצליח", error);
      return null;
    }
  },

  /** Resolves a stored path to disk, refusing one that escapes the storage root. */
  resolve(relativePath: string): string | null {
    const root = rootDir();
    const absolute = path.resolve(root, relativePath);
    if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
    return absolute;
  },

  /** Null when the file is gone from disk — the row can outlive its bytes. */
  async openRead(relativePath: string): Promise<ReadStream | null> {
    const absolute = documentStorage.resolve(relativePath);
    if (!absolute) return null;
    try {
      const stats = await stat(absolute);
      if (!stats.isFile()) return null;
    } catch {
      return null;
    }
    return createReadStream(absolute);
  },

  /** Best-effort: a document whose file is already gone is still removable. */
  async remove(relativePath: string): Promise<void> {
    const absolute = documentStorage.resolve(relativePath);
    if (!absolute) return;
    await unlink(absolute).catch(() => undefined);
  },
};
