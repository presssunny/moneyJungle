import { prisma } from "../../config/database";
import { verifyPassword } from "../../utils/password.utils";

export type Role = "ADMIN" | "USER" | "VIEWER";
export type AccountStatus = "active" | "inactive";

export interface Identity {
  id: number;
  email: string;
  /** Shown in the UI; separate from `email` so a display name can differ later. */
  displayName: string;
  role: Role;
  status: AccountStatus;
}

/**
 * The single place that answers "is this who they say they are?" — real,
 * per-account credentials now (replaces the old single shared env password;
 * see git history for that version). Multi-user, DB-backed.
 *
 * Identity on success, `null` on failure — never a reason, so the caller
 * cannot learn whether the email exists, whether the password was wrong, or
 * whether the account is disabled. A disabled (status !== "active") account
 * fails the same way a wrong password does — both `user.email` presence and
 * `status` are checked before the password compare, but the *response* never
 * distinguishes the reasons.
 */
export async function verifyCredentials(email: string, password: string): Promise<Identity | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.email || user.status !== "active") return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.name,
    role: user.role as Role,
    status: user.status as AccountStatus,
  };
}
