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
  computed: LoanComputed;
}

export interface LoanTotals {
  totalBalance: number;
  monthlyPayment: number;
  monthlyInterest: number;
  annualInterest: number;
  activeCount: number;
}

export interface LoanScheduleRow {
  month: number;
  interest: number;
  principal: number;
  balance: number;
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
}

export interface BankAccount {
  id: number;
  bankName: string;
  accountName: string;
  initialBalance: Money;
  currentBalance: Money;
  _count?: { transactions: number };
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
  insights: Insight[];
}

export interface ImportExpensesResult {
  parsed: number;
  created: number;
  skipped: number;
  totalAmount: number;
  months?: string[];
}
