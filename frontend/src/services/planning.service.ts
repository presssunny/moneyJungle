/** Services for planning domains: categories, payment methods, bank, recurring, subscriptions, savings, family, alerts, settings. */

import type {
  Alert,
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

export async function listSubscriptions(): Promise<{ items: Subscription[]; monthlyTotal: number }> {
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
