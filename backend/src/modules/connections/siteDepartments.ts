// No imports: shared by the worker (siteDiscovery) and the parent (probeLog's line grammar).
export const SITE_DEPARTMENTS = ["loans", "cards", "standing_orders", "cheques", "deposits"] as const;
export type SiteDepartment = (typeof SITE_DEPARTMENTS)[number];
/** Departments never visited: a repayment schedule is her own file's to state (CLAUDE.md §5, §7 clause A). */
export const EXCLUDED_DEPARTMENTS = ["loan_schedule"] as const;
export const DEPARTMENT_STOPS = ["NOT_IN_MENU", "REDIRECT", "HTTP_STATUS", "ERROR", "BUDGET", "SESSION_LOST", "CHALLENGE", "NEW_TAB", "CLOSED", "EXCLUDED"] as const;
export type DepartmentStop = (typeof DEPARTMENT_STOPS)[number];
/** A department's verdict from one pass: it landed, or why it is missing. */
export type DepartmentVisit = "landed" | DepartmentStop;
/** The details step's answer for a department outside CONNECTION_DEPARTMENT_READ. */
export const LOAN_DETAILS_NOT_APPROVED = "NOT_APPROVED";
/** CLAUDE.md §7 A2: the only departments whose tables may be read, and only with the flag. */
export const READABLE_DEPARTMENTS = ["loans", "standing_orders"] as const;
export type ReadableDepartment = (typeof READABLE_DEPARTMENTS)[number];
export const isReadableDepartment = (value: unknown): value is ReadableDepartment => READABLE_DEPARTMENTS.some((department) => department === value);

/** CONNECTION_DEPARTMENT_READ, a comma list: unknown words are dropped, unset or empty reads nothing. */
export function departmentReadList(raw: string | undefined): ReadableDepartment[] {
  const words = (raw ?? "").split(",").map((word) => word.trim());
  return READABLE_DEPARTMENTS.filter((department) => words.includes(department));
}
