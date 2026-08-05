import type { Loan, LoanSchedule } from "../types/models";
import { formatCurrency } from "./format";

/**
 * Exporting a loan's amortisation table. One shape, several formats: a new one is
 * a function here plus an entry in `LOAN_EXPORT_FORMATS`, no screen changes. PDF
 * goes through the browser's print dialog, so the app carries no PDF dependency.
 */

export type LoanExportFormat = "csv" | "text" | "pdf";

export const LOAN_EXPORT_FORMATS: Array<{ id: LoanExportFormat; label: string; icon: string }> = [
  { id: "pdf", label: "ייצוא PDF", icon: "📄" },
  { id: "csv", label: "ייצוא Excel/CSV", icon: "📊" },
  { id: "text", label: "העתקה כטקסט", icon: "📋" },
];

function loanTitle(loan: Loan): string {
  const parts = [loan.loanName];
  if (loan.loanNumber) parts.push(`הלוואה ${loan.loanNumber}`);
  if (loan.trackNumber) parts.push(`מסלול ${loan.trackNumber}`);
  return parts.join(" · ");
}

function download(fileName: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const HEADERS = ["מספר תשלום", "תאריך", "קרן", "ריבית", "סה\"כ", "יתרה לאחר התשלום"];

function rowsOf(schedule: LoanSchedule): string[][] {
  return schedule.rows.map((row) => [
    String(row.paymentNumber),
    row.date,
    row.principal.toFixed(2),
    row.interest.toFixed(2),
    row.total.toFixed(2),
    row.balanceAfter.toFixed(2),
  ]);
}

function toCsv(loan: Loan, schedule: LoanSchedule): void {
  const lines = [HEADERS, ...rowsOf(schedule)].map((cells) =>
    cells.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")
  );
  // A BOM makes Excel read the Hebrew headers as UTF-8 instead of mojibake.
  download(`${loanTitle(loan)}.csv`, `﻿${lines.join("\n")}`, "text/csv;charset=utf-8");
}

function toText(loan: Loan, schedule: LoanSchedule): void {
  const width = [12, 12, 12, 12, 12, 16];
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(width[i] ?? 12)).join("");
  const body = [
    loanTitle(loan),
    schedule.source === "bank_file" ? "לוח סילוקין מהבנק" : "לוח סילוקין מחושב (תרחיש)",
    "",
    line(HEADERS),
    "-".repeat(76),
    ...rowsOf(schedule).map(line),
    "-".repeat(76),
    line(["סה\"כ", "", schedule.totals.principal.toFixed(2), schedule.totals.interest.toFixed(2), "", ""]),
  ].join("\n");
  download(`${loanTitle(loan)}.txt`, body, "text/plain;charset=utf-8");
}

/**
 * Print-to-PDF. A standalone document is written into a hidden iframe so the
 * app's own layout, sidebar and theme never end up on the page.
 */
function toPdf(loan: Loan, schedule: LoanSchedule): void {
  const rows = rowsOf(schedule)
    .map(
      (cells, index) =>
        `<tr class="${schedule.rows[index]?.status === "paid" ? "paid" : ""}">` +
        cells.map((cell) => `<td>${cell}</td>`).join("") +
        "</tr>"
    )
    .join("");

  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>${loanTitle(loan)}</title>
<style>
  body { font-family: system-ui, "Segoe UI", Arial, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
  .facts { font-size: 12px; margin-bottom: 16px; }
  .facts span { margin-inline-end: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th, td { border-bottom: 1px solid #ddd; padding: 5px 6px; text-align: right; }
  th { background: #f4f4f5; font-weight: 600; }
  tr.paid td { color: #888; }
  tfoot td { font-weight: 700; border-top: 2px solid #333; }
  @page { margin: 14mm; }
</style></head><body>
<h1>${loanTitle(loan)}</h1>
<div class="meta">${
    schedule.source === "bank_file"
      ? "לוח סילוקין מדוח הבנק"
      : "לוח סילוקין מחושב — תרחיש, לא מדוח הבנק"
  } · הופק ${new Date().toLocaleDateString("he-IL")}</div>
<div class="facts">
  <span>יתרה: ${formatCurrency(loan.currentBalance)}</span>
  <span>החזר חודשי: ${formatCurrency(loan.monthlyPayment)}</span>
  <span>ריבית: ${loan.annualInterestRate}%</span>
  <span>תשלומים: ${loan.paymentsMade ?? "—"}/${loan.totalPayments ?? "—"}</span>
</div>
<table><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2">סה"כ</td><td>${schedule.totals.principal.toFixed(2)}</td><td>${schedule.totals.interest.toFixed(2)}</td><td colspan="2"></td></tr></tfoot>
</table></body></html>`;

  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "-10000px";
  frame.setAttribute("aria-hidden", "true");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    document.body.removeChild(frame);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  // Give the print dialog time to take its snapshot before the frame goes away.
  window.setTimeout(() => frame.remove(), 1000);
}

export function exportLoanSchedule(
  format: LoanExportFormat,
  loan: Loan,
  schedule: LoanSchedule
): void {
  if (format === "csv") return toCsv(loan, schedule);
  if (format === "text") return toText(loan, schedule);
  return toPdf(loan, schedule);
}
