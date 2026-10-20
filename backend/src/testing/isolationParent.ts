// A stand-in API server for scraperIsolation.test.ts: starts a Chrome-launching sync and
// prints the Chrome pid, so the test can SIGKILL this process and see what survives.
import path from "node:path";
import { isolatedScraperFactory } from "../modules/connections/scraperIsolation";

const [runRoot] = process.argv.slice(2);
const factory = isolatedScraperFactory({ library: path.resolve(__dirname, "scraperStub.ts"), runRoot });
void factory({ companyId: "beinleumi", startDate: new Date(), defaultTimeout: 5_000, loginMethod: "password", loginWaitMs: 60_000 }).then((run) => {
  run.onProgress((type) => { if (type.startsWith("chrome:")) console.log(type); });
  return run.scrape({ password: "x", mode: "chrome-hang" });
});
