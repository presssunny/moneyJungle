/** Entity types mirroring the backend API responses. Amounts arrive as strings (Prisma Decimal). */

export type Money = string | number;

export interface Category {
  id: number;
  userId: number | null;
  name: string;
  type: "expense" | "income";
  color: string | null;
  icon: string | null;
  isDefault?: boolean;
}

export interface CategoryRule {
  id: number;
  userId: number | null;
  keyword: string;
  categoryId: number;
  category?: Category;
}

export interface PaymentMethod {
  id: number;
  userId: number | null;
  name: string;
  type: string;
  isDefault: boolean;
}

export interface Expense {
  id: number;
  amount: Money;
  categoryId: number | null;
  paymentMethodId: number | null;
  businessName: string | null;
  description: string | null;
  expenseDate: string;
  isRecurring: boolean;
  category?: Category | null;
  paymentMethod?: PaymentMethod | null;
  // "manual" | "credit_import" | "bank_import" | "recurring" | "credit".
  // "credit" = a credit-card transaction shown read-only in the unified view;
  // it is edited in the אשראי tab, not here.
  source?: string;
}

export interface Income {
  id: number;
  amount: Money;
  type: string;
  description: string | null;
  incomeDate: string;
  isRecurring: boolean;
}

export interface BudgetItem {
  id: number;
  categoryId: number;
  category: Category;
  year: number;
  month: number;
  amount: number;
  spent: number;
  usedPercent: number;
  remaining: number;
}

export interface BudgetsResponse {
  budgets: BudgetItem[];
  totals: { total: number; used: number; usedPercent: number; remaining: number };
}

export interface LoanComputed {
  monthlyInterestRate: number;
  monthlyInterestPayment: number;
  monthlyPrincipalPayment: number;
  estimatedAnnualInterest: number;
  remainingMonths: number | null;
  totalRemainingInterest: number | null;
  isExpensive: boolean;
}

/** Where a loan stands in its life. Derived on the server, never stored. */
export type LoanLifecycle = "active" | "ending_soon" | "closed" | "overdue";

export interface LoanProgress {
  lifecycle: LoanLifecycle;
  principalRepaid: number;
  progressPercent: number;
  paymentsMade: number | null;
  paymentsRemaining: number | null;
  totalPayments: number | null;
  /** "scenario" while the opening amount is reconstructed rather than stated. */
  certainty: "measured" | "scenario";
}

export interface Loan {
  id: number;
  loanName: string;
  loanType: string;
  lenderName: string | null;
  originalAmount: number;
  currentBalance: number;
  annualInterestRate: number;
  monthlyPayment: number;
  startDate: string;
  endDate: string | null;
  isIndexLinked: boolean;
  earlyRepaymentFee: number | null;
  status: "active" | "finished" | "overdue";
  /** Bank identity: loan 108 can hold several tracks (432 / 562). */
  loanNumber: string | null;
  trackNumber: string | null;
  trackName: string | null;
  closedAt: string | null;
  closureReason: string | null;
  closureCost: number | null;
  totalPayments: number | null;
  paymentsMade: number | null;
  scheduleSource: "bank_file" | "computed";
  originalAmountSource: "contract" | "reconstructed" | "manual";
  scheduleImportedAt: string | null;
  computed: LoanComputed;
  progress: LoanProgress;
}

/** The six summary cards, computed server-side so the UI never derives money. */
export interface LoanSummary {
  activeCount: number;
  closedCount: number;
  totalBalance: number;
  monthlyPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  /** Monthly repayment that closing loans has freed up. */
  freedMonthlyPayment: number;
  closureCosts: number;
  endingSoonCount: number;
  hasScenarioProgress: boolean;
}

/** Tracks of one bank loan number, grouped for display only. */
export interface LoanGroup {
  loanNumber: string;
  trackIds: number[];
  totalBalance: number;
  activeTracks: number;
  closedTracks: number;
}

/** A closure the server detected from the statement — celebrated once. */
export interface LoanEvent {
  type: "loan_closed" | "payments_advanced";
  loanId: number;
  loanName: string;
  loanNumber: string | null;
  trackNumber: string | null;
  date: string;
  freedMonthlyPayment: number;
  savedInterest: number;
  closureCost: number;
  message: string;
}

export interface LoanTotals {
  totalBalance: number;
  monthlyPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  activeCount: number;
}

export interface LoanScheduleRow {
  paymentNumber: number;
  date: string;
  principal: number;
  interest: number;
  total: number;
  balanceAfter: number;
  status: "paid" | "next" | "future";
}

export interface LoanSchedule {
  /** "bank_file" = the bank's own table; "computed" = a simulation. */
  source: "bank_file" | "computed";
  certainty: "measured" | "scenario";
  rows: LoanScheduleRow[];
  totals: { principal: number; interest: number };
}

export interface EarlyRepaymentQuote {
  currentBalance: number;
  estimatedFee: number;
  payoffToday: number;
  savedInterest: number;
  netSaving: number;
  remainingPayments: number;
  remainingTotal: number;
  hasSchedule: boolean;
}

export interface CreditImport {
  id: number;
  fileName: string;
  importMonth: number;
  importYear: number;
  status: "pending" | "confirmed";
  totalAmount: number;
  totalTransactions: number;
  firstBillingDate?: string | null;
  lastBillingDate?: string | null;
  createdAt: string;
}

export type CreditTransactionType = "regular" | "standing_order" | "credit" | "refund" | "financing";

export interface CreditTransaction {
  id: number;
  transactionDate: string;
  chargeDate: string | null;
  billingDate: string;
  businessName: string;
  amount: Money;
  paymentCount: number;
  transactionType: CreditTransactionType;
  categoryId: number | null;
  category?: Category | null;
}

export interface CreditMonthBreakdown {
  monthKey: string;
  count: number;
  total: number;
}

export interface CreditImportDetail extends CreditImport {
  transactions: CreditTransaction[];
  monthlyBreakdown: CreditMonthBreakdown[];
  possibleDuplicate?: boolean;
}

export interface Alert {
  id: number;
  type: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  isRead: boolean;
  createdAt: string;
}

export interface Settings {
  id: number;
  theme: string;
  currency: string;
  activeMonth: string | null;
  language: string;
  dateFormat: string;
  monthlyTarget?: Money | null;
  notificationsJson?: Record<string, unknown> | null;
}

/**
 * Where an account balance came from. "statement" means it is anchored to a
 * balance the bank stated; "accumulated" means we could only add transactions
 * up, which no statement has confirmed.
 */
export interface BalanceDetail {
  balance: number;
  basis: "statement" | "accumulated";
  anchor: {
    statementId: number | null;
    fileName: string;
    coverageTo: string;
    closingBalance: number;
  } | null;
  afterAnchorNet: number;
  afterAnchorCount: number;
  explanation: string;
}

export interface BankAccount {
  id: number;
  bankName: string;
  accountName: string;
  initialBalance: Money;
  currentBalance: Money;
  balanceDetail?: BalanceDetail;
  _count?: { transactions: number };
}

/** One imported statement: the period it covers and the balances it printed. */
export interface BankStatementImport {
  id: number;
  fileName: string;
  coverageFrom: string;
  coverageTo: string;
  openingBalance: Money | null;
  closingBalance: Money | null;
  parsedRows: number;
  importedRows: number;
  skippedDuplicates: number;
  createdAt: string;
}

export interface BankTransaction {
  id: number;
  bankAccountId: number;
  transactionDate: string;
  description: string | null;
  amount: Money;
  type: "deposit" | "withdrawal" | "transfer" | "fee" | "other";
  categoryId: number | null;
  category?: Category | null;
}

export interface RecurringPayment {
  id: number;
  name: string;
  amount: Money;
  categoryId: number | null;
  paymentMethodId: number | null;
  frequency: "monthly" | "weekly" | "yearly";
  nextPaymentDate: string;
  category?: Category | null;
  paymentMethod?: PaymentMethod | null;
}

export interface Subscription {
  id: number;
  name: string;
  amount: Money;
  billingDate: string;
  frequency: "monthly" | "yearly";
  status: "active" | "inactive";
}

export interface SubscriptionCandidate {
  name: string;
  avgAmount: number;
  months: number;
  lastDate: string;
  nextBillingDate: string;
  confidence: "high" | "medium";
  reason: string;
}

export interface SavingsGoal {
  id: number;
  goalName: string;
  targetAmount: Money;
  currentAmount: Money;
  monthlyTarget: Money | null;
  targetDate: string | null;
}

export interface FamilyMember {
  id: number;
  name: string;
  createdAt: string;
  _count?: { expenses: number; incomes: number; loans: number };
}

export interface MonthlyReport {
  monthKey: string;
  previousMonthKey: string;
  current: { incomeTotal: number; expenseTotal: number; balance: number };
  previous: { incomeTotal: number; expenseTotal: number; balance: number };
  delta: { income: number; expense: number; balance: number };
  incomeByType: Array<{ type: string; label: string; value: number }>;
  byCategory: Array<{ name: string; color: string; icon: string; value: number }>;
  dailySpending: Array<{ day: number; daily: number; cumulative: number }>;
}

export interface TrendRow {
  monthKey: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
}

export interface Insight {
  icon: string;
  text: string;
  tone: "good" | "info" | "warning" | "bad";
}

export interface PaceAlert {
  tone: "good" | "warning" | "bad";
  title: string;
  detail: string;
  overBy: number;
  dailyToStayOnTrack: number | null;
}

export interface DashboardInsights {
  healthScore: number | null;
  scoreLabel: string;
  safePerDay: number | null;
  daysLeft: number;
  projection: {
    dailyBurn: number;
    projectedExpenses: number;
    projectedBalance: number;
  } | null;
  paceAlert: PaceAlert | null;
  insights: Insight[];
}

export interface Badge {
  key: string;
  icon: string;
  title: string;
  description: string;
  earned: boolean;
  progress?: number;
}

export interface Achievements {
  streak: {
    months: number;
    onTrackThisMonth: boolean;
    hasTarget: boolean;
    label: string;
  };
  monthsTracked: number;
  earnedCount: number;
  badges: Badge[];
}

export interface UpcomingEvent {
  date: string;
  kind: "recurring" | "subscription" | "loan" | "reminder";
  name: string;
  amount: number;
  icon: string;
}

export interface Upcoming {
  windowDays: number;
  from: string;
  to: string;
  total: number;
  events: UpcomingEvent[];
  heaviestDay: { date: string; total: number; count: number } | null;
}

/**
 * One line of "מוקדי תשומת לב". Merged on the server from alerts, reminders, the
 * forward forecast and the review counters — mirrors backend
 * `dashboard/attention.service.ts`, which is where the dedupe lives.
 */
export interface AttentionItem {
  id: string;
  icon: string;
  text: string;
  to: string;
  tone: "info" | "warning" | "critical";
}

export interface ImportExpensesResult {
  parsed: number;
  created: number;
  skipped: number;
  totalAmount: number;
  months?: string[];
}
