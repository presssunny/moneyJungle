import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "יש להזין אימייל").max(255),
  password: z.string().min(1, "יש להזין סיסמה"),
});

export type LoginBody = z.infer<typeof loginSchema>;
