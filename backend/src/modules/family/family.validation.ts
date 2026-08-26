import { z } from "zod";

/** Matches the options in FamilyMemberWizard.tsx's "מה הקשר?" step exactly. */
export const familyRelationSchema = z.enum(["spouse", "child", "parent", "other"]);

export const createFamilyMemberSchema = z.object({
  name: z.string().min(1, "יש להזין שם").max(120),
  relation: familyRelationSchema.optional(),
});

export const updateFamilyMemberSchema = createFamilyMemberSchema.partial();

export type CreateFamilyMemberBody = z.infer<typeof createFamilyMemberSchema>;
export type UpdateFamilyMemberBody = z.infer<typeof updateFamilyMemberSchema>;
