// pdf-parse ships no types. We import the inner lib path to avoid its
// debug-mode wrapper (which reads a bundled sample PDF at module load).
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  interface PdfPageData {
    getTextContent: (opts: unknown) => Promise<{
      items: Array<{ str: string; transform: number[]; width: number }>;
    }>;
  }
  interface PdfParseOptions {
    /** Custom per-page renderer; return the text to append for that page. */
    pagerender?: (pageData: PdfPageData) => Promise<string>;
    /** Max pages to parse (0 / undefined = all). */
    max?: number;
  }
  function pdfParse(dataBuffer: Buffer, options?: PdfParseOptions): Promise<PdfParseResult>;
  export = pdfParse;
}
