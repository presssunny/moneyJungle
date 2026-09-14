export interface ForecastMonth {
  monthKey: string;
  incomeTotal: number | null;
  expenseTotal: number | null;
  balance: number | null;
  scenarioBalance: number | null;
}

export interface ForecastScenario {
  monthlyIncomeChange: number;
  monthlyExpenseChange: number;
  oneTimeExpense: number;
  oneTimeMonth: number;
}

export interface ForecastHistoryMonth {
  monthKey: string;
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
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
