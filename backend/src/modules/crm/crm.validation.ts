import { z } from "zod";

export const userRoleSchema = z.enum(["ADMIN", "USER", "VIEWER"]);
export const userStatusSchema = z.enum(["active", "inactive"]);

export const createCustomerSchema = z.object({
  name: z.string().min(1, "יש להזין שם").max(120),
  email: z.string().email("כתובת אימייל לא תקינה").max(255),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים").max(255),
  role: userRoleSchema.default("USER"),
  status: userStatusSchema.optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email("כתובת אימייל לא תקינה").max(255).optional(),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים").max(255).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
});

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
