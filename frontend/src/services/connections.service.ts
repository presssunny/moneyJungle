import { api } from "./api";
import type { ConnectionProviderInfo, FinancialConnection, LoginMethod } from "../types/models";

/** No credentials: she signs in on the provider's own page; the server picks its official window. */
export interface ConnectionInput {
  provider: string;
  label?: string;
  bankAccountId?: number;
  accountHint?: string;
}

export interface ConnectionUpdate {
  loginMethod?: Extract<LoginMethod, "official_window">;
}

export async function listConnections(): Promise<{ providers: ConnectionProviderInfo[]; connections: FinancialConnection[] }> {
  return (await api.get("/connections")).data;
}
export async function getConnection(id: number, { quiet = false } = {}): Promise<FinancialConnection> {
  return (await api.get(`/connections/${id}`, { quiet })).data;
}
export async function createConnection(input: ConnectionInput): Promise<FinancialConnection> {
  return (await api.post("/connections", input)).data;
}
export async function updateConnection(id: number, update: ConnectionUpdate): Promise<FinancialConnection> {
  return (await api.patch(`/connections/${id}`, update)).data;
}
export async function deleteConnection(id: number): Promise<void> {
  await api.delete(`/connections/${id}`);
}
export async function syncConnection(id: number): Promise<FinancialConnection> {
  return (await api.post(`/connections/${id}/sync`)).data;
}
export async function cancelSync(id: number): Promise<FinancialConnection> {
  return (await api.post(`/connections/${id}/sync/cancel`)).data;
}
