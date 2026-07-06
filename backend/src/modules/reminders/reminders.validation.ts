import { z } from "zod";

export const createReminderSchema = z.object({
  title: z.string().min(1, "יש להזין כותרת").max(255),
  description: z.string().max(500).nullish(),
  eventDate: z.coerce.date(),
  estimatedAmount: z.coerce.number().positive().nullish(),
  type: z.enum(["birthday", "expected_expense", "event", "other"]).default("other"),
  icon: z.string().max(40).nullish(),
  isActive: z.boolean().optional(),
});

export const updateReminderSchema = createReminderSchema.partial();

export type CreateReminderBody = z.infer<typeof createReminderSchema>;
export type UpdateReminderBody = z.infer<typeof updateReminderSchema>;
