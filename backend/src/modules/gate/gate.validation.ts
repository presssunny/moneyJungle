import { z } from "zod";

export const loginSchema = z.object({
  password: z.string().min(1, "יש להזין סיסמה"),
});

export type LoginBody = z.infer<typeof loginSchema>;
