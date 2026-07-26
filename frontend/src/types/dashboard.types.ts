export interface DashboardSummary {
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
  creditTotal: number;
  savingsMonthly: number;
  /** Imported bank rows held out of the totals until the user names them. */
  bankReview: {
    pendingCount: number;
    pendingPrincipal: number;
    /** Rows with no meaning at all. Above 0 means money is not being counted. */
    unresolvedCount: number;
    /** Resolved but coarse: card bills nothing itemizes + loans received. */
    needsAttention: number;
  };
  /**
   * This month's bank rows by what they MEAN. The audit trail for the totals
   * above: money that left the account without being spending (loan principal, a
   * card bill already itemized in the credit tab) is named here rather than
   * leaving the month looking short.
   */
  bankMonth: {
    income: number;
    spend: number;
    financingCharged: number;
    financingCredited: number;
    financingNet: number;
    debtReduction: number;
    principal: number;
    loanUnsplit: number;
    loanDrawdown: number;
    cardSettled: number;
    unitemizedCard: number;
    internalTransfer: number;
    manualExcluded: number;
    unresolvedTotal: number;
    unresolvedCount: number;
  };
  budget: {
    total: number;
    used: number;
    usedPercent: number;
    overrunCount: number;
  };
  loans: {
    monthlyPayment: number;
    monthlyInterest: number;
    annualInterest: number;
    totalBalance: number;
    count: number;
  };
}

export interface TrendPoint {
  monthKey: string;
  income: number;
  expense: number;
}

export interface CategorySlice {
  name: string;
  color: string;
  icon?: string;
  value: number;
}

export interface LoanSplit {
  name: string;
  interest: number;
  principal: number;
}

export interface DashboardCharts {
  trend: TrendPoint[];
  byCategory: CategorySlice[];
  creditByCategory: CategorySlice[];
  loanSplit: LoanSplit[];
}

export interface TickerItem {
  id: string;
  type: string;
  icon: string;
  text: string;
  severity: "info" | "warning" | "critical";
  linkTo: string;
  date: string | null;
}

export interface Reminder {
  id: number;
  title: string;
  description: string | null;
  eventDate: string;
  estimatedAmount: number | string | null;
  type: "birthday" | "expected_expense" | "event" | "other";
  icon: string | null;
  isActive: boolean;
}

export interface RecentLists {
  expenses: Array<{
    id: number;
    amount: string | number;
    businessName: string | null;
    description: string | null;
    expenseDate: string;
    category: { name: string; icon: string | null } | null;
  }>;
  incomes: Array<{
    id: number;
    amount: string | number;
    type: string;
    description: string | null;
    incomeDate: string;
  }>;
  credit: Array<{
    id: number;
    amount: string | number;
    businessName: string;
    transactionDate: string;
    category: { name: string; icon: string | null } | null;
  }>;
  alerts: Array<{
    id: number;
    title: string;
    severity: "info" | "warning" | "critical";
    createdAt: string;
  }>;
}
