import { z } from "zod";

export const createFamilyMemberSchema = z.object({
  name: z.string().min(1, "יש להזין שם").max(120),
});

export const updateFamilyMemberSchema = createFamilyMemberSchema.partial();

export type CreateFamilyMemberBody = z.infer<typeof createFamilyMemberSchema>;
export type UpdateFamilyMemberBody = z.infer<typeof updateFamilyMemberSchema>;
