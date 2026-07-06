import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(1, "יש להזין שם קטגוריה").max(120),
  type: z.enum(["expense", "income"]).default("expense"),
  color: z.string().max(20).nullish(),
  icon: z.string().max(40).nullish(),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createRuleSchema = z.object({
  keyword: z.string().min(1, "יש להזין מילת מפתח").max(120),
  categoryId: z.coerce.number().int().positive(),
});

export const updateRuleSchema = createRuleSchema.partial();

export type CreateCategoryBody = z.infer<typeof createCategorySchema>;
export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>;
export type CreateRuleBody = z.infer<typeof createRuleSchema>;
export type UpdateRuleBody = z.infer<typeof updateRuleSchema>;
