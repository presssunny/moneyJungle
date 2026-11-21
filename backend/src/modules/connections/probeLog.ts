import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, fchmodSync, mkdirSync, openSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEPARTMENT_STOPS, EXCLUDED_DEPARTMENTS, SITE_DEPARTMENTS } from "./siteDepartments";

// On ext4 beside the run directories, never the server's stdout: that can be a file an agent reads.
export const PROBE_ROOT = path.join(os.homedir(), ".local/state/moneyjungle/probes");
export const PROBE_LINE_CAP = 300;

const LABEL = "(?::id|[a-z][a-z-]{0,30})";
const TEMPLATE = `${LABEL}(?:\\.${LABEL})*(?:/(?::id|[A-Za-z][A-Za-z_.-]{0,30})?)*`;
const METHOD = "(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)";
/**
 * Exactly what officialLogin's probe and siteDiscovery write, checked again here because the worker is untrusted:
 * no digit, "=", ";", "%" or "@" can reach the disk inside a template.
 */
const DEPT = `(?:${[...SITE_DEPARTMENTS, ...EXCLUDED_DEPARTMENTS].join("|")})`;
const ROUTE = "[A-Za-z][A-Za-z_]{0,30}(?:/[A-Za-z][A-Za-z_]{0,30}){0,11}";
const STOP = `(?:${DEPARTMENT_STOPS.join("|")})`;
const REQUEST = `tab \\d{1,3} (?:closed|(?:page|frame) ${TEMPLATE}|${METHOD} (?:document|xhr|fetch) ${TEMPLATE})|new ${TEMPLATE}`;
export const PROBE_LINE = new RegExp(`^(?:(?:dept ${DEPT} )?(?:${REQUEST})|dept ${DEPT} (?:(?:menu|landed) (?:route|page) ${ROUTE}|missing ${STOP})|menu links=\\d{1,3} matched=\\d)$`);

export interface ProbeSummary {
  file: string | null;
  written: number;
  dropped: number;
  rejected: number;
}

/**
 * One file per run, opened on its first line with owner-only access. Duplicates are skipped, past
 * the cap a line is counted, not written, and the closing line says how many were dropped or rejected.
 */
export function openProbeLog(root = PROBE_ROOT, cap = PROBE_LINE_CAP) {
  const started = Date.now();
  const seen = new Set<string>();
  const summary: ProbeSummary = { file: null, written: 0, dropped: 0, rejected: 0 };
  let fd: number | null = null;
  let closed = false;
  const append = (text: string) => {
    if (fd === null) {
      mkdirSync(root, { recursive: true, mode: 0o700 });
      chmodSync(root, 0o700);
      summary.file = path.join(root, `probe-${new Date(started).toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}.log`);
      fd = openSync(summary.file, "wx", 0o600);
      fchmodSync(fd, 0o600);
    }
    writeSync(fd, `[+${Math.round((Date.now() - started) / 1000)}s] ${text}\n`);
  };
  return {
    write(line: unknown) {
      if (closed) return;
      if (typeof line !== "string" || line.length > 300 || !PROBE_LINE.test(line)) { summary.rejected += 1; return; }
      if (seen.has(line)) return;
      // Past the cap nothing is remembered, so a flood costs a counter, not memory.
      if (summary.written >= cap) { summary.dropped += 1; return; }
      seen.add(line);
      summary.written += 1;
      try { append(line); } catch { summary.written -= 1; summary.dropped += 1; }
    },
    close(): ProbeSummary {
      if (closed) return { ...summary };
      closed = true;
      try {
        if (summary.written || summary.dropped || summary.rejected) append(`end written=${summary.written} dropped=${summary.dropped} rejected=${summary.rejected}`);
      } catch { /* the counts still reach the server log */ }
      if (fd !== null) closeSync(fd);
      fd = null;
      return { ...summary };
    },
  };
}
