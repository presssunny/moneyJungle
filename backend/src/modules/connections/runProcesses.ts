// Used by the API server and inside the sync worker: no imports from src/config or Prisma.
import { readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

function cwdOf(pid: number): string | null {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

/**
 * Kills every process working inside a run directory, with its process group. Chrome and its
 * helpers inherit the worker's cwd, so this catches a browser whose pid was never reported —
 * one that was still starting when the run was stopped.
 */
export function killProcessesIn(runDir: string, except = process.pid): number {
  let killed = 0;
  let entries: string[];
  try { entries = readdirSync("/proc"); } catch { return 0; }
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || pid === except) continue;
    const cwd = cwdOf(pid);
    if (cwd !== runDir && !cwd?.startsWith(`${runDir}${path.sep}`)) continue;
    for (const target of [-pid, pid]) {
      try { process.kill(target, "SIGKILL"); } catch { /* not a group leader, or already gone */ }
    }
    killed += 1;
  }
  return killed;
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
