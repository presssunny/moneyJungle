import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openProbeLog } from "./probeLog";

let root: string;
beforeEach(() => { root = path.join(mkdtempSync(path.join(os.tmpdir(), "probe-log-")), "probes"); });
afterEach(() => { rmSync(path.dirname(root), { recursive: true, force: true }); });

describe("openProbeLog", () => {
  it("writes a file only she can read, in a directory only she can open", () => {
    const log = openProbeLog(root);
    log.write("tab 1 page online.fibi.co.il/wps/myportal");
    const { file } = log.close();
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(file!).mode & 0o777).toBe(0o600);
    expect(readFileSync(file!, "utf8")).toMatch(/^\[\+\d+s\] tab 1 page online\.fibi\.co\.il\/wps\/myportal\n\[\+\d+s\] end written=1 dropped=0 rejected=0\n$/);
  });

  it("tightens a probes directory that already exists with wider access", () => {
    mkdirSync(root, { recursive: true });
    chmodSync(root, 0o755);
    const log = openProbeLog(root);
    log.write("tab 1 page online.fibi.co.il/a");
    log.close();
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it("refuses any line that is not a clean template, and says how many it refused", () => {
    const log = openProbeLog(root);
    const hostile = ["tab 1 page online.fibi.co.il/loans/12345678", "tab 1 page online.fibi.co.il/home;jsessionid=0000AbCd", "tab 1 GET xhr online.fibi.co.il/x?acct=1",
      "tab 1 POST xhr online.fibi.co.il/p/%D7%93", "tab 1 page online.fibi.co.il/u/dana@gmail.com", "tab 1 page online.fibi.co.il/otp/482", "tab 1 TRACE xhr online.fibi.co.il/x",
      "tab 1 GET image online.fibi.co.il/x", "anything else", 42, null, `tab 1 page online.fibi.co.il/${"a/".repeat(200)}`,
      "dept loans menu route Online/OnLoans/Loan58213", "dept loans menu route Online/הלוואות", "dept accounts missing NOT_IN_MENU", "dept loans missing BECAUSE",
      "dept loans landed route Online/:id", "menu links=1000 matched=4", "dept loans menu route Online/OnLoans?acct=1"];
    for (const line of hostile) log.write(line);
    log.write("tab 1 GET xhr online.fibi.co.il/api/loans/:id");
    log.write("dept loans landed route Online/OnLoansMortgageMenu/OnLoans/AuthLoansDetails");
    const summary = log.close();
    expect(summary).toMatchObject({ written: 2, dropped: 0, rejected: hostile.length });
    const text = readFileSync(summary.file!, "utf8");
    expect(text).toContain(`end written=2 dropped=0 rejected=${hostile.length}`);
    for (const secret of ["12345678", "jsessionid", "acct", "%D7", "dana", "482", "TRACE", "image"]) expect(text, secret).not.toContain(secret);
  });

  it("skips repeats and, past its cap, counts what it dropped instead of losing it silently", () => {
    const log = openProbeLog(root, 3);
    for (const word of ["a", "b", "a", "c", "d", "e"]) log.write(`tab 1 page online.fibi.co.il/${word}`);
    const summary = log.close();
    expect(summary).toMatchObject({ written: 3, dropped: 2, rejected: 0 });
    expect(readFileSync(summary.file!, "utf8").trim().split("\n").map((line) => line.replace(/^\[\+\d+s\] /, ""))).toEqual([
      "tab 1 page online.fibi.co.il/a", "tab 1 page online.fibi.co.il/b", "tab 1 page online.fibi.co.il/c", "end written=3 dropped=2 rejected=0",
    ]);
  });

  it("creates no file for a run that recorded nothing, and closes once", () => {
    const log = openProbeLog(root);
    expect(log.close()).toEqual({ file: null, written: 0, dropped: 0, rejected: 0 });
    log.write("tab 1 page online.fibi.co.il/a");
    expect(log.close().written).toBe(0);
    expect(() => readdirSync(root)).toThrow();
  });
});
