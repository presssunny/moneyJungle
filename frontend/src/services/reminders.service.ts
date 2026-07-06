import type { Reminder } from "../types/dashboard.types";
import { api } from "./api";

export interface ReminderInput {
  title: string;
  description?: string | null;
  eventDate: string;
  estimatedAmount?: number | null;
  type: Reminder["type"];
  icon?: string | null;
}

export async function listReminders(): Promise<Reminder[]> {
  const { data } = await api.get("/reminders");
  return data;
}

export async function createReminder(input: ReminderInput): Promise<Reminder> {
  const { data } = await api.post("/reminders", input);
  return data;
}

export async function updateReminder(id: number, input: Partial<ReminderInput> & { isActive?: boolean }): Promise<Reminder> {
  const { data } = await api.patch(`/reminders/${id}`, input);
  return data;
}

export async function deleteReminder(id: number): Promise<void> {
  await api.delete(`/reminders/${id}`);
}
