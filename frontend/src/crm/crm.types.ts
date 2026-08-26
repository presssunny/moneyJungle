/**
 * Types for the CRM screens only — deliberately not merged into
 * ../types/models.ts, which belongs to the customer-facing app. Shapes here
 * mirror backend/src/modules/crm/crm.service.ts response payloads exactly;
 * nothing here is invented past what that service actually returns.
 */

export type CrmRole = "ADMIN" | "USER" | "VIEWER";
export type CrmStatus = "active" | "inactive";

export interface CrmCustomerCounts {
  expenses: number;
  incomes: number;
  loans: number;
  bankAccounts: number;
  subscriptions: number;
  recurringPayments: number;
  documents: number;
  savingsGoals: number;
  budgets: number;
  creditImports: number;
  alerts: number;
  reminders: number;
  familyMembers: number;
}

export interface CrmCustomerListItem {
  id: number;
  name: string;
  email: string | null;
  role: CrmRole;
  status: CrmStatus;
  createdAt: string;
  updatedAt: string;
  counts: CrmCustomerCounts;
  recordCount: number;
  hasActivity: boolean;
  totalIncome: number;
  totalExpense: number;
  netCashflow: number;
  activeLoanBalance: number;
  bankBalance: number;
  lastActivityAt: string | null;
}

export interface CrmFamilyMember {
  id: number;
  name: string;
  relation: "spouse" | "child" | "parent" | "other" | null;
  createdAt: string;
}

export interface CrmSettings {
  theme: string;
  currency: string;
  language: string;
  dateFormat: string;
  activeMonth: string | null;
  monthlyTarget: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmIncome {
  id: number;
  amount: number;
  type: string;
  description: string | null;
  incomeDate: string;
  isRecurring: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CrmExpense {
  id: number;
  amount: number;
  businessName: string | null;
  description: string | null;
  expenseDate: string;
  isRecurring: boolean;
  source: string;
  categoryName: string | null;
  paymentMethodName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmBudget {
  id: number;
  month: number;
  year: number;
  amount: number;
  categoryName: string | null;
}

export interface CrmLoan {
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
  status: string;
  loanNumber: string | null;
  trackNumber: string | null;
  closedAt: string | null;
  closureReason: string | null;
  closureCost: number;
  scheduleEntryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmBankAccount {
  id: number;
  bankName: string;
  accountName: string;
  initialBalance: number;
  currentBalance: number;
  anchorBalance: number;
  anchorDate: string | null;
  transactionCount: number;
  statementCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmBankTransaction {
  id: number;
  transactionDate: string;
  description: string | null;
  amount: number;
  type: string;
  reconcileStatus: string;
  resolution: string | null;
  bankName: string;
  accountName: string;
}

export interface CrmCreditImport {
  id: number;
  fileName: string;
  importMonth: number;
  importYear: number;
  totalTransactions: number;
  totalAmount: number;
  status: string;
  transactionCount: number;
  createdAt: string;
}

export interface CrmRecurringPayment {
  id: number;
  name: string;
  amount: number;
  frequency: string;
  nextPaymentDate: string;
  categoryName: string | null;
  paymentMethodName: string | null;
}

export interface CrmSubscription {
  id: number;
  name: string;
  amount: number;
  billingDate: string;
  frequency: string;
  status: string;
}

export interface CrmDocument {
  id: number;
  fileName: string;
  sizeBytes: number;
  kind: string;
  status: string;
  detectedBank: string | null;
  rowsParsed: number;
  rowsImported: number;
  rowsSkipped: number;
  uploadedAt: string;
}

export interface CrmSavingsGoal {
  id: number;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  monthlyTarget: number;
  targetDate: string | null;
}

export interface CrmPaymentMethod {
  id: number;
  name: string;
  type: string;
  isDefault: boolean;
}

export interface CrmAlert {
  id: number;
  type: string;
  title: string;
  message: string;
  severity: string;
  isRead: boolean;
  createdAt: string;
}

export interface CrmReminder {
  id: number;
  title: string;
  description: string | null;
  eventDate: string;
  estimatedAmount: number;
  type: string;
  isActive: boolean;
}

export interface CrmCustomerDetail {
  profile: {
    id: number;
    name: string;
    email: string | null;
    role: CrmRole;
    status: CrmStatus;
    createdAt: string;
    updatedAt: string;
  };
  familyMembers: CrmFamilyMember[];
  settings: CrmSettings | null;
  financials: {
    incomes: CrmIncome[];
    incomeTotal: number;
    expenses: CrmExpense[];
    expenseTotal: number;
    budgets: CrmBudget[];
  };
  loans: CrmLoan[];
  bank: {
    accounts: CrmBankAccount[];
    totalBalance: number;
    recentTransactions: CrmBankTransaction[];
  };
  credit: {
    imports: CrmCreditImport[];
  };
  recurringPayments: CrmRecurringPayment[];
  subscriptions: CrmSubscription[];
  documents: CrmDocument[];
  savingsGoals: CrmSavingsGoal[];
  paymentMethods: CrmPaymentMethod[];
  alerts: CrmAlert[];
  reminders: CrmReminder[];
  personalization: {
    customCategoriesCount: number;
    customCategoryRulesCount: number;
  };
}
