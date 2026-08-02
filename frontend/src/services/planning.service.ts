/** Services for planning domains: categories, payment methods, bank, recurring, subscriptions, savings, family, alerts, settings. */

import type {
  Alert,
  BalanceDetail,
  BankStatementImport,
  BankAccount,
  BankTransaction,
  Category,
  CategoryRule,
  FamilyMember,
  PaymentMethod,
  RecurringPayment,
  SavingsGoal,
  Settings,
  Subscription,
  SubscriptionCandidate,
} from "../types/models";
import { api } from "./api";

// ---------- Categories & rules ----------

export async function listCategories(): Promise<Category[]> {
  const { data } = await api.get("/categories");
  return data;
}

export async function createCategory(input: { name: string; type: string; color?: string | null; icon?: string | null }): Promise<Category> {
  const { data } = await api.post("/categories", input);
  return data;
}

export async function updateCategory(id: number, input: Partial<{ name: string; type: string; color: string | null; icon: string | null }>): Promise<Category> {
  const { data } = await api.patch(`/categories/${id}`, input);
  return data;
}

export async function deleteCategory(id: number): Promise<void> {
  await api.delete(`/categories/${id}`);
}

export async function listRules(): Promise<CategoryRule[]> {
  const { data } = await api.get("/categories/rules");
  return data;
}

export async function createRule(input: { keyword: string; categoryId: number }): Promise<CategoryRule> {
  const { data } = await api.post("/categories/rules", input);
  return data;
}

export async function deleteRule(id: number): Promise<void> {
  await api.delete(`/categories/rules/${id}`);
}

// ---------- Payment methods ----------

export async function listPaymentMethods(): Promise<PaymentMethod[]> {
  const { data } = await api.get("/payment-methods");
  return data;
}

export async function createPaymentMethod(input: { name: string; type: string }): Promise<PaymentMethod> {
  const { data } = await api.post("/payment-methods", input);
  return data;
}

export async function updatePaymentMethod(id: number, input: Partial<{ name: string; type: string }>): Promise<PaymentMethod> {
  const { data } = await api.patch(`/payment-methods/${id}`, input);
  return data;
}

export async function deletePaymentMethod(id: number): Promise<void> {
  await api.delete(`/payment-methods/${id}`);
}

// ---------- Bank ----------

export interface BankAccountInput {
  bankName: string;
  accountName: string;
  initialBalance?: number;
}

export async function listBankAccounts(): Promise<BankAccount[]> {
  const { data } = await api.get("/bank/accounts");
  return data;
}

export async function createBankAccount(input: BankAccountInput): Promise<BankAccount> {
  const { data } = await api.post("/bank/accounts", input);
  return data;
}

export async function updateBankAccount(id: number, input: Partial<BankAccountInput>): Promise<BankAccount> {
  const { data } = await api.patch(`/bank/accounts/${id}`, input);
  return data;
}

export async function deleteBankAccount(id: number): Promise<void> {
  await api.delete(`/bank/accounts/${id}`);
}

export async function listBankStatements(accountId: number): Promise<BankStatementImport[]> {
  const { data } = await api.get(`/bank/accounts/${accountId}/statements`);
  return data;
}

/** State the balance the bank shows as of a date, anchoring the account. */
export async function setBankAnchor(
  accountId: number,
  input: { balance: number; asOf: string }
): Promise<BalanceDetail> {
  const { data } = await api.post(`/bank/accounts/${accountId}/anchor`, input);
  return data;
}

export async function listBankTransactions(accountId: number): Promise<BankTransaction[]> {
  const { data } = await api.get(`/bank/accounts/${accountId}/transactions`);
  return data;
}

export async function createBankTransaction(
  accountId: number,
  input: { transactionDate: string; description?: string | null; amount: number; type: string; categoryId?: number | null }
): Promise<BankTransaction> {
  const { data } = await api.post(`/bank/accounts/${accountId}/transactions`, input);
  return data;
}

export async function deleteBankTransaction(id: number): Promise<void> {
  await api.delete(`/bank/transactions/${id}`);
}

export interface BankImportResult {
  parsed: number;
  imported: number;
  skippedDuplicates: number;
  deposits: number;
  withdrawals: number;
}

export async function importBankStatement(accountId: number, file: File): Promise<BankImportResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/bank/accounts/${accountId}/import`, form);
  return data;
}

// ---------- Bank reconciliation ----------

/**
 * What a bank row turned out to MEAN. Mirrors `BankResolution` on the server —
 * the labels come with the payload, so the wording lives in one place.
 */
export type BankResolution =
  | "income"
  | "expense"
  | "financing_charge"
  | "financing_credit"
  | "debt_reduction"
  | "loan_repayment_unsplit"
  | "loan_drawdown"
  | "credit_card_settled"
  | "credit_card_unitemized"
  | "internal_transfer"
  | "manual_excluded";

export interface ReconcileRow {
  id: number;
  date: string;
  description: string;
  amount: number;
  type: string;
  lineKind: string;
  loanRef: string | null;
  reconcileStatus: string;
  resolution: BankResolution | null;
  resolutionLabel: string | null;
  /** Hebrew reason for the decision — always shown next to the row. */
  reconcileNote: string | null;
  needsReview: boolean;
  linkedIncomeId: number | null;
  linkedLoanId: number | null;
  linkedExpenseId: number | null;
  suggestedIncomeType?: string;
  suggestedIncomeLabel?: string;
}

export interface ReconcileLoanGroup {
  loanRef: string | null;
  label: string;
  principalTotal: number;
  interestTotal: number;
  mixedTotal: number;
  count: number;
  rows: ReconcileRow[];
}

export interface ReconciliationView {
  summary: {
    total: number;
    pending: number;
    done: number;
    excluded: number;
    /** Rows with no meaning at all. Anything above 0 is money falling through. */
    unresolved: number;
    needsReview: number;
    income: number;
    spend: number;
    financingNet: number;
    debtReduction: number;
    unitemizedCard: number;
    settledCard: number;
    internalTransfer: number;
  };
  byResolution: Array<{
    resolution: BankResolution | "unresolved";
    label: string;
    count: number;
    total: number;
    rows: ReconcileRow[];
  }>;
  needsReview: ReconcileRow[];
  incomeCandidates: ReconcileRow[];
  loanGroups: ReconcileLoanGroup[];
  standardSpend: ReconcileRow[];
  financingLines: ReconcileRow[];
  creditCardPayments: ReconcileRow[];
  done: ReconcileRow[];
}

export async function getReconciliation(): Promise<ReconciliationView> {
  const { data } = await api.get("/bank/reconciliation");
  return data;
}

/** One bucket of a resolve pass: how many rows and how much money. */
export interface ResolveBucket {
  count: number;
  total: number;
}

/** What one resolve pass decided, bucket by bucket. */
export interface ResolveResult {
  changed: number;
  income: ResolveBucket;
  spend: ResolveBucket;
  financingCharged: ResolveBucket;
  financingCredited: ResolveBucket;
  debtReduction: ResolveBucket;
  loanUnsplit: ResolveBucket;
  loanDrawdown: ResolveBucket;
  cardSettled: ResolveBucket;
  cardUnitemized: ResolveBucket;
  internalTransfer: ResolveBucket;
  manualExcluded: ResolveBucket;
  /** Must stay 0 — a row the resolver could not give a meaning to. */
  unresolved: ResolveBucket;
}

export async function reconcileAuto(): Promise<ResolveResult> {
  const { data } = await api.post("/bank/reconciliation/auto");
  return data;
}

/** Loan activity as the bank statement reports it — no invented loan terms. */
export interface StatementLoanGroup {
  loanRef: string | null;
  label: string;
  principalPaid: number;
  interestPaid: number;
  interestRefunded: number;
  unsplitPaid: number;
  drawdown: number;
  linkedLoanId: number | null;
  months: string[];
  rows: Array<{
    id: number;
    date: string;
    description: string;
    amount: number;
    lineKind: string;
    resolution: string | null;
    note: string | null;
  }>;
}

export interface StatementLoanActivity {
  groups: StatementLoanGroup[];
  totals: {
    principalPaid: number;
    interestPaid: number;
    interestRefunded: number;
    unsplitPaid: number;
    drawdown: number;
    debtReduction: number;
  };
}

export async function getStatementLoanActivity(): Promise<StatementLoanActivity> {
  const { data } = await api.get("/bank/reconciliation/loans");
  return data;
}

export async function reconcileIncome(id: number, input: { type: string; description?: string | null }): Promise<void> {
  await api.post(`/bank/reconciliation/${id}/income`, input);
}

export async function reconcileExpense(id: number, input: { categoryId?: number | null }): Promise<void> {
  await api.post(`/bank/reconciliation/${id}/expense`, input);
}

export interface ReconcileLoanInput {
  loanId?: number;
  transactionIds: number[];
  loanName?: string;
  loanType?: string;
  lenderName?: string | null;
  originalAmount?: number;
  currentBalance?: number;
  annualInterestRate?: number;
  monthlyPayment?: number;
  startDate?: string;
}

export async function reconcileLoan(input: ReconcileLoanInput): Promise<void> {
  await api.post("/bank/reconciliation/loan", input);
}

export async function reconcileExclude(id: number): Promise<void> {
  await api.post(`/bank/reconciliation/${id}/exclude`);
}

export async function reconcileReset(id: number): Promise<void> {
  await api.post(`/bank/reconciliation/${id}/reset`);
}

// ---------- Recurring payments ----------

export interface RecurringInput {
  name: string;
  amount: number;
  categoryId?: number | null;
  paymentMethodId?: number | null;
  frequency: string;
  nextPaymentDate: string;
}

export async function listRecurring(): Promise<{ items: RecurringPayment[]; monthlyTotal: number }> {
  const { data } = await api.get("/recurring");
  return data;
}

export async function createRecurring(input: RecurringInput): Promise<RecurringPayment> {
  const { data } = await api.post("/recurring", input);
  return data;
}

export async function updateRecurring(id: number, input: Partial<RecurringInput>): Promise<RecurringPayment> {
  const { data } = await api.patch(`/recurring/${id}`, input);
  return data;
}

export async function deleteRecurring(id: number): Promise<void> {
  await api.delete(`/recurring/${id}`);
}

export async function generateRecurring(monthKey: string): Promise<{ created: number; skipped: number }> {
  const [year, month] = monthKey.split("-").map(Number);
  const { data } = await api.post("/recurring/generate", { year, month });
  return data;
}

// ---------- Subscriptions ----------

export interface SubscriptionInput {
  name: string;
  amount: number;
  billingDate: string;
  frequency: string;
  status?: string;
}

export async function listSubscriptions(): Promise<{
  items: Subscription[];
  monthlyTotal: number;
  /** Yearly cost of the active subscriptions, normalised on the server (§4). */
  annualTotal: number;
  activeCount: number;
}> {
  const { data } = await api.get("/subscriptions");
  return data;
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  const { data } = await api.post("/subscriptions", input);
  return data;
}

export async function updateSubscription(id: number, input: Partial<SubscriptionInput>): Promise<Subscription> {
  const { data } = await api.patch(`/subscriptions/${id}`, input);
  return data;
}

export async function deleteSubscription(id: number): Promise<void> {
  await api.delete(`/subscriptions/${id}`);
}

export async function getSubscriptionCandidates(): Promise<SubscriptionCandidate[]> {
  const { data } = await api.get("/subscriptions/candidates");
  return data;
}

// ---------- Savings goals ----------

export interface SavingsGoalInput {
  goalName: string;
  targetAmount: number;
  currentAmount?: number;
  monthlyTarget?: number | null;
  targetDate?: string | null;
}

export async function listSavingsGoals(): Promise<SavingsGoal[]> {
  const { data } = await api.get("/savings");
  return data;
}

export async function createSavingsGoal(input: SavingsGoalInput): Promise<SavingsGoal> {
  const { data } = await api.post("/savings", input);
  return data;
}

export async function updateSavingsGoal(id: number, input: Partial<SavingsGoalInput>): Promise<SavingsGoal> {
  const { data } = await api.patch(`/savings/${id}`, input);
  return data;
}

export async function depositToGoal(id: number, amount: number): Promise<SavingsGoal> {
  const { data } = await api.post(`/savings/${id}/deposit`, { amount });
  return data;
}

export async function deleteSavingsGoal(id: number): Promise<void> {
  await api.delete(`/savings/${id}`);
}

// ---------- Family ----------

export async function listFamily(): Promise<FamilyMember[]> {
  const { data } = await api.get("/family");
  return data;
}

export async function createFamilyMember(name: string): Promise<FamilyMember> {
  const { data } = await api.post("/family", { name });
  return data;
}

export async function updateFamilyMember(id: number, name: string): Promise<FamilyMember> {
  const { data } = await api.patch(`/family/${id}`, { name });
  return data;
}

export async function deleteFamilyMember(id: number): Promise<void> {
  await api.delete(`/family/${id}`);
}

// ---------- Alerts ----------

export async function listAlerts(): Promise<Alert[]> {
  const { data } = await api.get("/alerts");
  return data;
}

export async function markAlertRead(id: number): Promise<void> {
  await api.patch(`/alerts/${id}/read`);
}

export async function markAllAlertsRead(): Promise<void> {
  await api.patch("/alerts/read-all");
}

export async function deleteAlert(id: number): Promise<void> {
  await api.delete(`/alerts/${id}`);
}

// ---------- Settings ----------

export async function getSettings(): Promise<Settings> {
  const { data } = await api.get("/settings");
  return data;
}

export async function updateSettings(input: Partial<Settings>): Promise<Settings> {
  const { data } = await api.patch("/settings", input);
  return data;
}

// ---------- Onboarding (first-run flag stored in Settings.notificationsJson) ----------

export function isOnboardingComplete(settings: Settings): boolean {
  return settings.notificationsJson?.onboardingCompleted === true;
}

/** Persist the "onboarding done" flag, merging into the existing notifications JSON. */
export async function completeOnboarding(settings: Settings): Promise<Settings> {
  const merged = { ...(settings.notificationsJson ?? {}), onboardingCompleted: true };
  return updateSettings({ notificationsJson: merged });
}
