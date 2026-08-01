import { z } from "zod";

export const loginSchema = z.object({
  /**
   * Optional so a client that predates the login screen — or a saved bookmark
   * that posts only a password — keeps working. When present it is verified.
   */
  username: z.string().min(1, "יש להזין שם משתמש").max(60).optional(),
  password: z.string().min(1, "יש להזין סיסמה"),
});

export type LoginBody = z.infer<typeof loginSchema>;
