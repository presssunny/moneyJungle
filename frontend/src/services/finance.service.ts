/** CRUD services for the core money domains (expenses, incomes, budgets, loans, credit). */

import type {
  BudgetsResponse,
  CreditImport,
  CreditImportDetail,
  Expense,
  Income,
  ImportExpensesResult,
  Loan,
  LoanScheduleRow,
  LoanTotals,
  MonthlyReport,
  TrendRow,
} from "../types/models";
import { api } from "./api";

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

export async function listLoans(): Promise<{ loans: Loan[]; totals: LoanTotals }> {
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

export async function getLoanSchedule(id: number): Promise<LoanScheduleRow[]> {
  const { data } = await api.get(`/loans/${id}/schedule`);
  return data;
}

// ---------- Credit ----------

export async function listCreditImports(): Promise<CreditImport[]> {
  const { data } = await api.get("/credit/imports");
  return data;
}

export async function uploadCreditImport(file: File, monthKey?: string): Promise<CreditImportDetail> {
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
