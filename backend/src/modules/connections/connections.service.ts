import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { PROVIDERS, providerInfo, type ProviderInfo } from "./providers";
import { retryBlock } from "./syncPolicy";
import { importRows } from "../imports/importRows.service";
import { accountBalanceService } from "../bank/accountBalance.service";
import type { SyncOutcomeItem } from "../../types/connections.types";
import type { LoginMethod } from "../../types/connections.types";
import type { CreateConnectionBody, UpdateConnectionBody } from "./connections.validation";

function requireMethod(provider: ProviderInfo, method: LoginMethod) {
  if (!provider.loginMethods.length) throw ApiError.badRequest(provider.unavailableReason ?? `${provider.name} עוד לא נתמך בחיבור`);
  if (!provider.loginMethods.some((m) => m.id === method)) throw ApiError.badRequest(`שיטת הכניסה הזו אינה זמינה ב${provider.name}`);
}

async function requireBankAccount(userId: number, id: number | null | undefined) {
  if (!id || !(await prisma.bankAccount.findFirst({ where: { id, userId } }))) throw ApiError.badRequest("יש לבחור לאיזה חשבון בנק במערכת נכנסות התנועות");
}

// Never select `credentials`: the sealed blob stays inside the sync service.
const PUBLIC_FIELDS = {
  id: true, provider: true, kind: true, label: true, bankAccountId: true, accountHint: true, loginMethod: true, blockedReason: true,
  verifiedAt: true, lastSyncAt: true, createdAt: true,
  syncs: {
    orderBy: { id: "desc" as const }, take: 1,
    select: { id: true, status: true, phase: true, method: true, errorType: true, message: true, outcome: true, deadlineAt: true, startedAt: true, finishedAt: true },
  },
};

type PublicConnection = NonNullable<Awaited<ReturnType<typeof findPublic>>>;
const findPublic = (userId: number, id: number) => prisma.financialConnection.findFirst({ where: { id, userId }, select: PUBLIC_FIELDS });

const outcomeOf = (connection: PublicConnection) => (Array.isArray(connection.syncs[0]?.outcome) ? (connection.syncs[0].outcome as unknown as SyncOutcomeItem[]) : []);

/**
 * Synced bank rows carry no running balance, so completeness is checked against the site's own
 * balance once the import is approved (banker 2026-10-17). Ours comes from the one balance service.
 */
async function ourBalance(userId: number, connection: PublicConnection, item: SyncOutcomeItem, status: string | undefined): Promise<number | null> {
  if (connection.kind !== "bank" || !connection.bankAccountId || item.siteBalance == null || status !== "completed") return null;
  return (await accountBalanceService.derive(userId, connection.bankAccountId)).balance;
}

/**
 * Adds what the page needs and must not compute itself: the retry rule start() enforces, and each
 * import's own counts from the import screen — never SyncOutcomeItem.rows, which includes the overlap.
 */
async function present(userId: number, connections: PublicConnection[]) {
  const ids = connections.flatMap((c) => outcomeOf(c).map((item) => item.importSessionId).filter((id): id is string => !!id));
  const review = await importRows.summaries(userId, ids);
  return Promise.all(connections.map(async (connection) => {
    const block = retryBlock(connection, connection.syncs[0]);
    const outcome = await Promise.all(outcomeOf(connection).map(async (item) => {
      const itemReview = item.importSessionId ? review.get(item.importSessionId) ?? null : null;
      return { ...item, review: itemReview, ourBalance: await ourBalance(userId, connection, item, itemReview?.status) };
    }));
    const syncs = connection.syncs.map((sync, index) => (index > 0 ? sync : { ...sync, outcome }));
    return { ...connection, syncs, retryBlockedReason: block?.reason ?? null, retryMessage: block?.message ?? null, retryAvailableAt: block?.until ?? null };
  }));
}

async function owned(userId: number, id: number) {
  const connection = await findPublic(userId, id);
  if (!connection) throw ApiError.notFound("החיבור לא נמצא");
  return (await present(userId, [connection]))[0];
}

export const connectionsService = {
  providers() {
    return Object.values(PROVIDERS);
  },

  async list(userId: number) {
    const connections = await prisma.financialConnection.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { id: "asc" }], select: PUBLIC_FIELDS });
    return present(userId, connections);
  },

  get: owned,

  async create(userId: number, body: CreateConnectionBody) {
    const provider = providerInfo(body.provider);
    if (!provider) throw ApiError.badRequest("ספק החיבור אינו נתמך");
    const method = body.loginMethod ?? provider.loginMethods[0]?.id ?? "official_window";
    requireMethod(provider, method);
    if (provider.kind === "bank") await requireBankAccount(userId, body.bankAccountId);
    // official_window stores nothing: she signs in on the bank's own page every time.
    const created = await prisma.financialConnection.create({
      data: {
        userId, provider: provider.id, kind: provider.kind, label: body.label?.trim() || provider.name, loginMethod: method,
        bankAccountId: provider.kind === "bank" ? body.bankAccountId : null, accountHint: body.accountHint?.trim() || null, credentials: null,
      },
    });
    return owned(userId, created.id);
  },

  /**
   * A connection made with stored credentials (before 2026-10-20) can move to the official window:
   * the credentials are dropped, and it is unverified until a login there succeeds.
   */
  async update(userId: number, id: number, body: UpdateConnectionBody) {
    const existing = await prisma.financialConnection.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("החיבור לא נמצא");
    const provider = providerInfo(existing.provider);
    if (!provider) throw ApiError.badRequest("ספק החיבור אינו נתמך");
    if (provider.kind === "bank" && body.bankAccountId !== undefined) await requireBankAccount(userId, body.bankAccountId);
    const relogin = !!body.loginMethod && body.loginMethod !== existing.loginMethod;
    if (relogin) requireMethod(provider, body.loginMethod!);
    await prisma.financialConnection.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label.trim() || provider.name } : {}),
        ...(body.bankAccountId !== undefined && provider.kind === "bank" ? { bankAccountId: body.bankAccountId } : {}),
        ...(body.accountHint !== undefined ? { accountHint: body.accountHint.trim() || null } : {}),
        ...(relogin ? { loginMethod: body.loginMethod, credentials: null, verifiedAt: null, blockedReason: null } : {}),
      },
    });
    return owned(userId, id);
  },

  async remove(userId: number, id: number) {
    await owned(userId, id);
    await prisma.financialConnection.delete({ where: { id } });
  },
};
