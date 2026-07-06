import { z } from "zod";

/** API uses dashed theme names ("neon-purple"); Prisma enum uses underscores. */
export const themeNames = ["neon-purple", "dark-luxury", "red-cyan"] as const;

export const updateSettingsSchema = z.object({
  theme: z.enum(themeNames).optional(),
  currency: z.string().min(1).max(8).optional(),
  activeMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "פורמט חודש לא תקין (YYYY-MM)")
    .nullish(),
  language: z.string().min(1).max(8).optional(),
  dateFormat: z.string().min(1).max(20).optional(),
  notificationsJson: z.record(z.string(), z.unknown()).nullish(),
});

export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;
