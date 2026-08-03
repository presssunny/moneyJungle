/** CRUD services for the core money domains (expenses, incomes, budgets, loans, credit). */

import type {
  BudgetsResponse,
  CreditImport,
  CreditImportDetail,
  Expense,
  Income,
  ImportExpensesResult,
  EarlyRepaymentQuote,
  Loan,
  LoanEvent,
  LoanGroup,
  LoanSchedule,
  LoanSummary,
  LoanTotals,
  MonthlyReport,
  TrendRow,
} from "../types/models";
import type { StatementLoanActivity } from "./planning.service";
import { api } from "./api";
import type { AssistantAnswers, AssistantStep } from "../types/assistant";

function monthParams(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

// ---------- Expenses ----------

export interface ExpenseInput {
  amount: number;
  categoryId?: number | null;
  paymentMethodId?: number | null;
  businessName?: string | null;
  description?: string | null;
  expenseDate: string;
  isRecurring?: boolean;
}

export interface MonthProgress {
  spent: number;
  target: number | null;
  targetSource: "goal" | "last_month" | "none";
  goal: number | null;
  lastMonthSpend: number;
  isCurrentMonth: boolean;
  isFuture: boolean;
  daysInMonth: number;
  dayOfMonth: number;
  daysLeft: number;
  dailyBurn: number;
  projected: number | null;
}

export async function listExpenses(
  monthKey: string,
  categoryId?: number
): Promise<{ expenses: Expense[]; total: number; progress: MonthProgress }> {
  const { data } = await api.get("/expenses", { params: { ...monthParams(monthKey), categoryId } });
  return data;
}

export async function createExpense(input: ExpenseInput): Promise<Expense> {
  const { data } = await api.post("/expenses", input);
  return data;
}

export async function updateExpense(id: number, input: Partial<ExpenseInput>): Promise<Expense> {
  const { data } = await api.patch(`/expenses/${id}`, input);
  return data;
}

export async function deleteExpense(id: number): Promise<void> {
  await api.delete(`/expenses/${id}`);
}

export interface QuickAddResult {
  expense: Expense;
  parsed: {
    amount: number;
    businessName: string;
    categoryId: number | null;
    categoryName: string | null;
    categoryIcon: string | null;
  };
}

/** Free-text quick add: send raw Hebrew text, server parses amount + business + category. */
export async function quickAddExpense(text: string): Promise<QuickAddResult> {
  const { data } = await api.post("/expenses/quick-add", { text });
  return data;
}

/** Outcome of a smart import: what the file was, and what actually went in. */
export interface SmartImportResult {
  kind: "bank" | "credit" | "loan_schedule" | "unknown";
  detectionReason: string;
  matchedSignals: string[];
  fileName: string;
  parsedRows: number;
  importedRows: number;
  skippedDuplicates: number;
  alreadyImported: boolean;
  message: string;
  creditImportId?: number;
  bankAccountId?: number;
  /** The conversation: narration, facts, and anything still unanswered. */
  assistant: AssistantStep;
}

/**
 * Upload a statement without saying what it is. `kind` is sent only when the
 * user overrides a detection she disagrees with.
 */
export async function smartImportFile(
  file: File,
  kind?: "bank" | "credit",
  /**
   * Replies to a previous `assistant.questions`. The SAME file is re-sent with
   * them — the server keeps no pending upload, so a restart mid-conversation
   * costs nothing.
   */
  answers?: AssistantAnswers
): Promise<SmartImportResult> {
  const form = new FormData();
  form.append("file", file);
  if (kind) form.append("kind", kind);
  if (answers && Object.keys(answers).length > 0) form.append("answers", JSON.stringify(answers));
  const { data } = await api.post("/imports/smart", form);
  return data;
}

export async function importExpensesFile(file: File, monthKey: string): Promise<ImportExpensesResult> {
  const { year, month } = monthParams(monthKey);
  const form = new FormData();
  form.append("file", file);
  form.append("year", String(year));
  form.append("month", String(month));
  const { data } = await api.post("/imports/expenses", form);
  return data;
}

// ---------- Incomes ----------

export interface IncomeInput {
  amount: number;
  type: string;
  description?: string | null;
  incomeDate: string;
  isRecurring?: boolean;
}

export async function listIncomes(monthKey: string): Promise<{ incomes: Income[]; total: number }> {
  const { data } = await api.get("/incomes", { params: monthParams(monthKey) });
  return data;
}

export async function createIncome(input: IncomeInput): Promise<Income> {
  const { data } = await api.post("/incomes", input);
  return data;
}

export async function updateIncome(id: number, input: Partial<IncomeInput>): Promise<Income> {
  const { data } = await api.patch(`/incomes/${id}`, input);
  return data;
}

export async function deleteIncome(id: number): Promise<void> {
  await api.delete(`/incomes/${id}`);
}

// ---------- Budgets ----------

export async function listBudgets(monthKey: string): Promise<BudgetsResponse> {
  const { data } = await api.get("/budgets", { params: monthParams(monthKey) });
  return data;
}

export async function upsertBudget(monthKey: string, categoryId: number, amount: number): Promise<void> {
  const { year, month } = monthParams(monthKey);
  await api.put("/budgets", { categoryId, amount, year, month });
}

/** Copy the previous month's budgets into the given month. */
export async function copyBudgets(toMonthKey: string): Promise<{ copied: number }> {
  const { data } = await api.post("/budgets/copy-previous", monthParams(toMonthKey));
  return data;
}

export async function deleteBudget(id: number): Promise<void> {
  await api.delete(`/budgets/${id}`);
}

// ---------- Loans ----------

export interface LoanInput {
  loanName: string;
  loanType: string;
  lenderName?: string | null;
  originalAmount: number;
  currentBalance: number;
  annualInterestRate: number;
  monthlyPayment: number;
  startDate: string;
  endDate?: string | null;
  isIndexLinked?: boolean;
  earlyRepaymentFee?: number | null;
  status?: string;
}

export async function listLoans(): Promise<{
  loans: Loan[];
  summary: LoanSummary;
  groups: LoanGroup[];
  /** Closures detected during this call — the UI celebrates these once. */
  events: LoanEvent[];
  /** Loan activity read straight off the bank statement — see StatementLoanActivity. */
  fromStatement: StatementLoanActivity;
  totals: LoanTotals;
}> {
  const { data } = await api.get("/loans");
  return data;
}

export async function createLoan(input: LoanInput): Promise<Loan> {
  const { data } = await api.post("/loans", input);
  return data;
}

export async function updateLoan(id: number, input: Partial<LoanInput>): Promise<Loan> {
  const { data } = await api.patch(`/loans/${id}`, input);
  return data;
}

export async function deleteLoan(id: number): Promise<void> {
  await api.delete(`/loans/${id}`);
}

export async function getLoanSchedule(id: number): Promise<LoanSchedule> {
  const { data } = await api.get(`/loans/${id}/schedule`);
  return data;
}

/** What the bank's amortisation file said, and what changed because of it. */
export interface ScheduleImportResult {
  loanId: number;
  created: boolean;
  loanName: string;
  loanNumber: string | null;
  trackNumber: string | null;
  rowsStored: number;
  message: string;
  /** What the app could not decide alone and needs the user to answer. */
  questions: Array<{ code: string; text: string }>;
  /** Same conversation contract as the statement importer. */
  assistant: AssistantStep;
}

/**
 * Upload a לוח סילוקין. The file becomes the loan's source of truth: balance,
 * rate, payment, counts and dates are all read from it, so nothing is typed in.
 * Re-uploading for the same loan updates it instead of creating a second one.
 */
export async function importLoanSchedule(file: File, loanId?: number): Promise<ScheduleImportResult> {
  const form = new FormData();
  form.append("file", file);
  if (loanId !== undefined) form.append("loanId", String(loanId));
  const { data } = await api.post("/loans/schedule/import", form);
  return data;
}

export async function closeLoan(
  id: number,
  input: { closedAt: string; reason: string; closureCost?: number | null }
): Promise<{ event: LoanEvent; loan: Loan | null }> {
  const { data } = await api.post(`/loans/${id}/close`, input);
  return data;
}

/** Read-only: what paying this loan off today would cost and save. */
export async function getEarlyRepaymentQuote(id: number): Promise<EarlyRepaymentQuote> {
  const { data } = await api.get(`/loans/${id}/early-repayment`);
  return data;
}

// ---------- Credit ----------

export async function listCreditImports(): Promise<CreditImport[]> {
  const { data } = await api.get("/credit/imports");
  return data;
}

/**
 * A credit upload either creates an import, or finds every row already stored
 * and creates nothing. The two outcomes are different shapes, discriminated by
 * `alreadyImported`, so a caller cannot read a transaction count that isn't there.
 */
export type CreditUploadResult =
  | ({ alreadyImported: false; skippedDuplicates: number; parsedRows: number } & CreditImportDetail)
  | {
      alreadyImported: true;
      skippedDuplicates: number;
      parsedRows: number;
      previousImport: { id: number; fileName: string; createdAt: string } | null;
    };

export async function uploadCreditImport(file: File, monthKey?: string): Promise<CreditUploadResult> {
  const form = new FormData();
  form.append("file", file);
  if (monthKey) {
    const { year, month } = monthParams(monthKey);
    form.append("importYear", String(year));
    form.append("importMonth", String(month));
  }
  const { data } = await api.post("/credit/imports", form);
  return data;
}

export async function getCreditImport(id: number): Promise<CreditImportDetail> {
  const { data } = await api.get(`/credit/imports/${id}`);
  return data;
}

export async function confirmCreditImport(id: number): Promise<CreditImportDetail> {
  const { data } = await api.patch(`/credit/imports/${id}/confirm`);
  return data;
}

export async function deleteCreditImport(id: number): Promise<void> {
  await api.delete(`/credit/imports/${id}`);
}

export async function updateCreditTransaction(id: number, categoryId: number | null): Promise<void> {
  await api.patch(`/credit/transactions/${id}`, { categoryId });
}

export async function recategorizeCredit(): Promise<{ scanned: number; categorized: number }> {
  const { data } = await api.post("/credit/recategorize");
  return data;
}

// ---------- Reports ----------

export async function getMonthlyReport(monthKey: string): Promise<MonthlyReport> {
  const { data } = await api.get("/reports/monthly", { params: monthParams(monthKey) });
  return data;
}

export async function getTrendReport(monthKey: string): Promise<TrendRow[]> {
  const { data } = await api.get("/reports/trend", { params: monthParams(monthKey) });
  return data;
}
