import { z } from "zod";

export const paymentMethodTypes = [
  "cash",
  "credit_card",
  "credit_installments",
  "bank_transfer",
  "bit",
  "paybox",
  "standing_order",
  "check",
] as const;

export const createPaymentMethodSchema = z.object({
  name: z.string().min(1, "יש להזין שם").max(120),
  type: z.enum(paymentMethodTypes),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.partial();

export type CreatePaymentMethodBody = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodBody = z.infer<typeof updatePaymentMethodSchema>;
