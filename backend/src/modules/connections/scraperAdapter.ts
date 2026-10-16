import { ApiError } from "../../utils/ApiError";
import type { ConnectionProvider, ScrapeResult } from "../../types/connections.types";

export interface ScraperOptions {
  companyId: ConnectionProvider;
  startDate: Date;
  /** Page-wait ceiling; the only lever that lets a login sit while the user approves on her phone. */
  defaultTimeout: number;
  storeFailureScreenShotPath: string;
}

export interface ScraperRun {
  onProgress(listener: (type: string) => void): void;
  scrape(credentials: Record<string, string>): Promise<ScrapeResult>;
}

export type ScraperFactory = (options: ScraperOptions) => Promise<ScraperRun>;

// Loaded on first sync, not at boot: it pulls in puppeteer and a Chrome binary.
const LIBRARY = "israeli-bank-scrapers";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export const createLibraryScraper: ScraperFactory = async (options) => {
  let lib: unknown;
  try {
    lib = await import(LIBRARY);
  } catch {
    throw ApiError.internal("רכיב החיבור לבנקים לא מותקן בשרת (npm i israeli-bank-scrapers בתיקיית backend).");
  }
  const createScraper = isRecord(lib) ? lib.createScraper : undefined;
  if (typeof createScraper !== "function") throw ApiError.internal("גרסת רכיב החיבור לבנקים אינה נתמכת.");
  const scraper: unknown = createScraper({ ...options, combineInstallments: false, showBrowser: false, verbose: false });
  if (!isRecord(scraper) || typeof scraper.scrape !== "function" || typeof scraper.onProgress !== "function") {
    throw ApiError.internal("גרסת רכיב החיבור לבנקים אינה נתמכת.");
  }
  const { scrape, onProgress } = scraper;
  return {
    onProgress(listener) {
      onProgress.call(scraper, (_company: unknown, payload: unknown) => {
        if (isRecord(payload) && typeof payload.type === "string") listener(payload.type);
      });
    },
    async scrape(credentials) {
      const result: unknown = await scrape.call(scraper, credentials);
      if (!isRecord(result) || typeof result.success !== "boolean") return { success: false, errorType: "GENERAL_ERROR", errorMessage: "unexpected scraper result" };
      return result as unknown as ScrapeResult;
    },
  };
};
