import { api } from "./api";
import type { CreditCardInput, ForecastResponse, ForecastScenario, WalletResponse } from "../types/models";

export async function listCreditCards() {
  const { data } = await api.get<Array<CreditCardInput & { id: number }>>("/credit/cards");
  return data;
}

export async function getForecast(scenario: ForecastScenario, excludedMonths: string[]): Promise<ForecastResponse> {
  const { data } = await api.get<ForecastResponse>("/reports/forecast", { params: { ...scenario, excludedMonths: excludedMonths.join(",") } });
  return data;
}
export async function getWallet(monthKey: string): Promise<WalletResponse> {
  const [year, month] = monthKey.split("-").map(Number);
  const { data } = await api.get<WalletResponse>("/credit/wallet", { params: { year, month } });
  return data;
}
export async function createCreditCard(input: CreditCardInput) {
  const { data } = await api.post<{ id: number }>("/credit/cards", input);
  return data;
}
export async function updateCreditCard(id: number, input: CreditCardInput) {
  const { data } = await api.patch<{ id: number }>(`/credit/cards/${id}`, input);
  return data;
}
export async function assignCreditCard(importId: number, cardId: number | null) {
  await api.patch(`/credit/imports/${importId}/card`, { cardId });
}
export async function assignTransactionCard(id: number, cardId: number | null) {
  await api.patch(`/credit/transactions/${id}/card`, { cardId });
}
