import { api } from "../services/api";
import type { CrmCustomerDetail, CrmCustomerListItem, CrmRole, CrmStatus } from "./crm.types";

export interface CreateCrmCustomerInput {
  name: string;
  email: string;
  password: string;
  role: CrmRole;
  status?: CrmStatus;
}

export interface UpdateCrmCustomerInput {
  name?: string;
  email?: string;
  password?: string;
  role?: CrmRole;
  status?: CrmStatus;
}

/**
 * API client for the CRM's own namespace (/api/crm/*). Read routes are
 * reachable by ADMIN and VIEWER; create/update are ADMIN-only — enforced by
 * the Backend (requireRole in crm.routes.ts), not by this file. A VIEWER
 * calling createCrmCustomer/updateCrmCustomer gets a 403 from the server.
 */
export async function listCrmCustomers(): Promise<CrmCustomerListItem[]> {
  const { data } = await api.get("/crm/customers");
  return data;
}

export async function getCrmCustomer(id: number): Promise<CrmCustomerDetail> {
  const { data } = await api.get(`/crm/customers/${id}`);
  return data;
}

export async function createCrmCustomer(input: CreateCrmCustomerInput): Promise<CrmCustomerListItem> {
  const { data } = await api.post("/crm/customers", input);
  return data;
}

export async function updateCrmCustomer(id: number, input: UpdateCrmCustomerInput): Promise<CrmCustomerListItem> {
  const { data } = await api.patch(`/crm/customers/${id}`, input);
  return data;
}
