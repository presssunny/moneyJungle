import { api } from "./api";
import type { ConnectionProviderInfo, FinancialConnection } from "../types/models";

export interface ConnectionInput {
  provider: string;
  label?: string;
  bankAccountId?: number;
  accountHint?: string;
  credentials: Record<string, string>;
}

export async function listConnections(): Promise<{ providers: ConnectionProviderInfo[]; connections: FinancialConnection[] }> {
  return (await api.get("/connections")).data;
}
export async function getConnection(id: number): Promise<FinancialConnection> {
  return (await api.get(`/connections/${id}`)).data;
}
export async function createConnection(input: ConnectionInput): Promise<FinancialConnection> {
  return (await api.post("/connections", input)).data;
}
export async function updateConnectionCredentials(id: number, credentials: Record<string, string>): Promise<FinancialConnection> {
  return (await api.patch(`/connections/${id}`, { credentials })).data;
}
export async function deleteConnection(id: number): Promise<void> {
  await api.delete(`/connections/${id}`);
}
export async function syncConnection(id: number): Promise<FinancialConnection> {
  return (await api.post(`/connections/${id}/sync`)).data;
}
