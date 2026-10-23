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
  source: "manual" | "bank_import";
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
  /** null = unknown (e.g. seen only as a statement debit) — never render as 0. */
  originalAmount: number | null;
  currentBalance: number | null;
  annualInterestRate: number | null;
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
  scheduleSource: "bank_file" | "computed" | "statement";
  originalAmountSource: "contract" | "reconstructed" | "manual" | "unknown";
  scheduleImportedAt: string | null;
  /** null while the balance or the rate is unknown. */
  computed: LoanComputed | null;
  progress: LoanProgress;
}

/** The six summary cards, computed server-side so the UI never derives money. */
export interface LoanSummary {
  activeCount: number;
  closedCount: number;
  /** Known balances only; `unknownBalanceCount` loans are not in it. */
  totalBalance: number;
  monthlyPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  unknownBalanceCount: number;
  unknownInterestCount: number;
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
  unknownBalanceCount: number;
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
  unknownBalanceCount: number;
  unknownInterestCount: number;
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

export type GoalType = "savings" | "purchase" | "debt_payoff";

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  percent: number;
  complete: boolean;
  source: "manual" | "loan" | "unavailable";
  /** Loan goals: when the loan balance was last written — not updated by each monthly debit. */
  asOf: string | null;
}

export interface SavingsGoal {
  id: number;
  goalName: string;
  goalType: GoalType;
  loanId: number | null;
  loan: { id: number; loanName: string } | null;
  targetAmount: Money;
  currentAmount: Money;
  monthlyTarget: Money | null;
  targetDate: string | null;
  progress: GoalProgress;
}

export interface SavingsGoalList {
  goals: SavingsGoal[];
  /** Savings and purchase goals only — a loan payoff is not money set aside. */
  summary: { savedTotal: number; targetTotal: number; setAsideCount: number; completion: number | null };
}

export type AssetType = "investment" | "pension" | "real_estate" | "other";

export interface Asset {
  id: number;
  name: string;
  assetType: AssetType;
  currentValue: Money;
  asOfDate: string;
}

export type FamilyRelation = "spouse" | "child" | "parent" | "other";

/**
 * A household member associated with the signed-in account — not a login of
 * its own, and not an owner of financial records (those all belong to the
 * account itself). See backend/prisma/schema.prisma's FamilyMember model.
 */
export interface FamilyMember {
  id: number;
  name: string;
  relation: FamilyRelation | null;
  createdAt: string;
  updatedAt: string;
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
  scoreComponents: Array<{label:string;points:number;maximum:number;detail:string}>;
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

export interface ForecastScenario {
  monthlyIncomeChange: number;
  monthlyExpenseChange: number;
  oneTimeExpense: number;
  oneTimeMonth: number;
}

export interface ForecastResponse {
  backtest: { monthsTested: number; meanAbsoluteExpenseError: number | null };
  generatedAt: string;
  anchorMonth: string;
  sufficient: boolean;
  baselineMonths: string[];
  history: TrendRow[];
  months: Array<{ monthKey: string; incomeTotal: number | null; expenseTotal: number | null; balance: number | null; scenarioBalance: number | null }>;
  annualBalance: number | null;
  scenarioAnnualBalance: number | null;
  commitments: Array<{ monthKey: string; total: number; events: Array<{ date: string; name: string; amount: number; kind: string }> }>;
  heaviest: { monthKey: string; total: number } | null;
}

export interface WalletTransaction {
  id: number;
  cardId: number | null;
  businessName: string;
  amount: number;
  billingDate: string;
  transactionDate: string;
  chargeDate: string | null;
  categoryName: string;
  transactionType: string;
  paymentCount: number;
}

export interface WalletSummary {
  total: number;
  previousTotal: number | null;
  delta: number | null;
  nextCharge: { date: string; amount: number } | null;
  categories: Array<{ name: string; amount: number }>;
  transactions: WalletTransaction[];
  financingTotal: number;
}

export interface CreditCardInput {
  name: string;
  issuer: string;
  lastFour: string;
  billingDay: number | null;
}

export interface WalletResponse {
  lastConfirmedImportAt: string | null;
  updatedAt: string;
  pendingCount: number;
  cards: Array<CreditCardInput & WalletSummary & { id: number }>;
  all: WalletSummary;
  unassigned: WalletSummary;
}

export interface DuplicateRecord {
  key: string;
  kind: "expense" | "credit" | "income";
  name: string;
  date: string;
  amount: number;
  to: string;
  scope: string;
  version: string;
}

export interface DuplicateCandidate {
  id: string;
  reason: "same_entry" | "manual_and_card";
  records: DuplicateRecord[];
  recordCount: number;
  version: string;
  reopened?: boolean;
}

export type DuplicateDecision = "separate" | "remove_manual" | "source_charge";
export interface DuplicateReviewView {
  id: string;
  candidateId: string;
  version: string;
  decision: DuplicateDecision;
  status: "active" | "stale" | "undone";
  createdAt: string;
  undoneAt: string | null;
  records: DuplicateRecord[];
  recordCount: number;
  removedKey: string | null;
  keptKey: string | null;
  canUndo: boolean;
  undoBlockedReason: string | null;
}
export interface DuplicateReviewResult {
  review: DuplicateReviewView;
  financialDomain: "expenses" | "incomes" | null;
}
export interface DuplicateReviewInput {
  requestId: string;
  candidateId: string;
  version: string;
  decision: DuplicateDecision;
  confirmed: true;
  removedKey?: string;
  keptKey?: string;
}

export interface AssistantAction {
  id: string;
  title: string;
  reason: string;
  to: string;
  priority: number;
  kind: "review" | "duplicate" | "payment" | "budget" | "goal";
}

export interface HouseholdSnapshot {
  version: string;
  generatedAt: string;
  month: string;
  hasActivity: boolean;
  totals: { incomeTotal: number; expenseTotal: number; creditTotal: number };
  allowance: { amount: number | null; state: string };
  blockers: string[];
  actions: AssistantAction[];
  actionCount: number;
  upcoming: { key: string; name: string; date: string; amount: number | null; to: string }[];
  duplicates: {
    from: string;
    to: string;
    scanned: number;
    limited: boolean;
    candidateCount: number;
    followUpCount?: number;
    candidates: DuplicateCandidate[];
  };
  aiAvailable: boolean;
}

export interface AssistantPlan {
  version: string;
  mode: "ai" | "rules" | "stale";
  actionIds: string[];
}

export interface ActivityEvent {
  id: number;
  domain: string;
  action: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEvent[];
  nextCursor: number | null;
}

export interface QuestionFact {
  label: string;
  value: number | null;
  display: string;
}

export interface QuestionAnswer {
  mode: "rules" | "ai" | "unanswered";
  intent: string | null;
  answer: string;
  facts: QuestionFact[];
  links: Array<{ label: string; to: string }>;
  limitations: string[];
  examples: string[];
}

/** One server page of a month's ledger. filtered* describe the filter; month* are the month's own figures. */
export interface LedgerPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  filteredCount: number;
  filteredTotal: number;
  monthTotal: number;
  monthCount: number;
}

export interface IncomeLedgerPage extends LedgerPage<Income> {
  byType: Array<{ type: string; label: string; amount: number }>;
  recurringCount: number;
}

/** A bank/card website login synced on demand. Credentials never come back from the API. */
export type ConnectionKind = "bank" | "card";
export type SyncStatus = "running" | "succeeded" | "failed" | "cancelled";
/** Set by the server from real login/fetch events only — the UI never infers a phase. */
export type SyncPhase = "queued" | "launching" | "awaiting_user" | "awaiting_bank" | "fetching" | "building_import";
export type LoginMethod = "password" | "official_window";

export interface LoginMethodInfo {
  id: LoginMethod;
  label: string;
  description: string;
  /** experimental: built, not yet tried against the real bank. */
  status: "supported" | "experimental";
}

export interface ConnectionProviderInfo {
  id: string;
  kind: ConnectionKind;
  name: string;
  /** Offered for new connections; empty when no window of its own can be opened yet. */
  loginMethods: LoginMethodInfo[];
  /** The provider's own address the official window opens — shown so she can check the window. */
  officialLoginUrl: string | null;
  unavailableReason: string | null;
  approvalHint: string | null;
}

export interface ForeignRef {
  date: string;
  description: string;
  originalAmount: number;
  originalCurrency: string;
  chargedAmount: number | null;
  chargedCurrency: string | null;
}

export interface SyncOutcomeItem {
  key: string;
  importSessionId: string | null;
  target: string;
  /** Includes the overlap with stored rows — never shown; `review.counts` is what the import holds. */
  rows: number;
  skippedPending: number;
  skippedForeign: number;
  skippedZero: number;
  storedThrough: string | null;
  pending: Array<{ date: string; description: string; amount: number }>;
  foreign?: ForeignRef[];
  siteBalance?: number | null;
  /** Our balance for the account, given only once this import is approved — to check nothing is missing. */
  ourBalance?: number | null;
  note?: string;
  review: { status: string; counts: { included: number; duplicate: number; pending: number } } | null;
}

export interface ConnectionSync {
  id: number;
  status: SyncStatus;
  phase: SyncPhase | null;
  method: LoginMethod;
  errorType: string | null;
  message: string | null;
  outcome: SyncOutcomeItem[] | null;
  /** End of the wait we allow for the login — not a deadline the bank announced. */
  deadlineAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface FinancialConnection {
  id: number;
  provider: string;
  kind: ConnectionKind;
  label: string;
  bankAccountId: number | null;
  accountHint: string | null;
  loginMethod: LoginMethod;
  blockedReason: string | null;
  verifiedAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  syncs: ConnectionSync[];
  /** The server's own retry rule: credentials = blocked until new details; cooldown = wait until retryAvailableAt. */
  retryBlockedReason: "credentials" | "cooldown" | null;
  retryMessage: string | null;
  retryAvailableAt: string | null;
}
