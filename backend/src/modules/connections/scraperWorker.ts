// Runs in its own process with a stripped env (see scraperIsolation.ts). It must not import
// anything under src/config or the Prisma client: this process never holds the cipher key or DB access.
import type { WorkerCommand, WorkerEvent } from "../../types/connections.types";
import { killProcessesIn } from "./runProcesses";
import { libraryOptions } from "./scraperLaunch";

interface LibraryScraper {
  scrape(credentials: Record<string, string>): Promise<unknown>;
  onProgress(listener: (company: unknown, payload: unknown) => void): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function send(event: WorkerEvent): Promise<void> {
  return new Promise((resolve) => (process.send ? process.send(event, () => resolve()) : resolve()));
}

// Puppeteer starts Chrome detached, as the leader of its own process group, so killing this
// worker's group alone would leave a logged-in browser running. Chrome shares our cwd (the run dir).
function terminate(code: number): never {
  killProcessesIn(process.cwd());
  try { process.kill(-process.pid, "SIGKILL"); } catch { /* not a group leader (run by hand) */ }
  process.exit(code);
}

async function fail(code: "MISSING_LIBRARY" | "UNSUPPORTED" | "CRASH", message: string): Promise<never> {
  await send({ type: "error", code, message: message.slice(0, 500) });
  return terminate(1);
}

let scraper: LibraryScraper | null = null;

async function handle(command: WorkerCommand): Promise<void> {
  if (command.type === "start") {
    let lib: unknown;
    try {
      lib = await import(command.library);
    } catch {
      return fail("MISSING_LIBRARY", command.library);
    }
    const createScraper = isRecord(lib) ? lib.createScraper : undefined;
    if (typeof createScraper !== "function") return fail("UNSUPPORTED", "createScraper missing");
    const created: unknown = createScraper(libraryOptions(command.options));
    if (!isRecord(created) || typeof created.scrape !== "function" || typeof created.onProgress !== "function") {
      return fail("UNSUPPORTED", "scraper shape");
    }
    scraper = created as unknown as LibraryScraper;
    scraper.onProgress((_company, payload) => {
      if (isRecord(payload) && typeof payload.type === "string") void send({ type: "progress", progress: payload.type });
    });
    return send({ type: "ready" });
  }
  if (!scraper) return fail("CRASH", "scrape before start");
  const result = await scraper.scrape(command.credentials);
  await send({ type: "result", result });
  terminate(0);
}

process.on("disconnect", () => terminate(1));
process.on("message", (message: unknown) => {
  handle(message as WorkerCommand).catch((error: unknown) => fail("CRASH", error instanceof Error ? error.message : String(error)));
});
