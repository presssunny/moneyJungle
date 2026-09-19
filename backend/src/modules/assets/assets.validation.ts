import { z } from "zod";

export const assetTypes = ["investment", "pension", "real_estate", "other"] as const;

export const createAssetSchema = z.object({
  name: z.string().min(1, "יש להזין שם נכס").max(120),
  assetType: z.enum(assetTypes),
  currentValue: z.coerce.number().min(0, "הסכום לא יכול להיות שלילי").max(999999999999, "הסכום גדול מדי"),
  asOfDate: z.coerce.date(),
});

export const updateAssetSchema = createAssetSchema.partial();

export type CreateAssetBody = z.infer<typeof createAssetSchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetSchema>;
