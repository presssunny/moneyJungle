import { Prisma } from "../../generated/prisma/client";

/** Round to 2 decimal places (money). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Convert a Prisma Decimal (or null) to a plain number for JSON responses. */
export function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

/** Sum an array of Prisma Decimals into a rounded number. */
export function sumDecimals(values: Array<Prisma.Decimal | number | null | undefined>): number {
  return round2(values.reduce<number>((acc, v) => acc + decimalToNumber(v), 0));
}

/** Shekels inside a sentence — whole numbers, because agorot only add noise there. */
/** Whole shekels by default; `exact` keeps agorot when there are any, for answers the household may check against a statement. */
export function formatILS(amount: number, { exact = false } = {}): string {
  const digits = exact && !Number.isInteger(Math.round(amount * 100) / 100) ? 2 : 0;
  return `₪${amount.toLocaleString("he-IL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return round2((used / total) * 100);
}
