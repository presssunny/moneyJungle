import { z } from "zod";

export const subscriptionFrequencies = ["monthly", "yearly"] as const;
export const subscriptionStatuses = ["active", "inactive"] as const;

export const createSubscriptionSchema = z.object({
  name: z.string().min(1, "יש להזין שם מנוי").max(120),
  amount: z.coerce.number().positive("יש להזין סכום חיובי").max(9999999999, "הסכום גדול מדי"),
  billingDate: z.coerce.date(),
  frequency: z.enum(subscriptionFrequencies).default("monthly"),
  status: z.enum(subscriptionStatuses).optional(),
});

export const updateSubscriptionSchema = createSubscriptionSchema.partial();

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionBody = z.infer<typeof updateSubscriptionSchema>;
