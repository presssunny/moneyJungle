import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { sealCredentials } from "./credentialsCipher";
import { PROVIDERS, providerInfo, type ProviderInfo } from "./providers";
import type { CreateConnectionBody, UpdateConnectionBody } from "./connections.validation";

function requiredCredentials(provider: ProviderInfo, given: Record<string, string>): Record<string, string> {
  const missing = provider.fields.filter((f) => !given[f.key]?.trim());
  if (missing.length) throw ApiError.badRequest(`חסרים פרטים: ${missing.map((f) => f.label).join(", ")}`);
  return Object.fromEntries(provider.fields.map((f) => [f.key, given[f.key].trim()]));
}

async function requireBankAccount(userId: number, id: number | null | undefined) {
  if (!id || !(await prisma.bankAccount.findFirst({ where: { id, userId } }))) throw ApiError.badRequest("יש לבחור לאיזה חשבון בנק במערכת נכנסות התנועות");
}

// Never select `credentials`: the sealed blob stays inside the sync service.
const PUBLIC_FIELDS = {
  id: true, provider: true, kind: true, label: true, bankAccountId: true, accountHint: true,
  verifiedAt: true, lastSyncAt: true, createdAt: true,
  syncs: { orderBy: { startedAt: "desc" as const }, take: 1, select: { id: true, status: true, message: true, outcome: true, startedAt: true, finishedAt: true } },
};

async function owned(userId: number, id: number) {
  const connection = await prisma.financialConnection.findFirst({ where: { id, userId }, select: PUBLIC_FIELDS });
  if (!connection) throw ApiError.notFound("החיבור לא נמצא");
  return connection;
}

export const connectionsService = {
  providers() {
    return Object.values(PROVIDERS);
  },

  async list(userId: number) {
    return prisma.financialConnection.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { id: "asc" }], select: PUBLIC_FIELDS });
  },

  get: owned,

  async create(userId: number, body: CreateConnectionBody) {
    const provider = providerInfo(body.provider);
    if (!provider) throw ApiError.badRequest("ספק החיבור אינו נתמך");
    if (provider.kind === "bank") await requireBankAccount(userId, body.bankAccountId);
    const credentials = sealCredentials(userId, requiredCredentials(provider, body.credentials));
    const created = await prisma.financialConnection.create({
      data: {
        userId, provider: provider.id, kind: provider.kind, label: body.label?.trim() || provider.name,
        bankAccountId: provider.kind === "bank" ? body.bankAccountId : null, accountHint: body.accountHint?.trim() || null, credentials,
      },
    });
    return owned(userId, created.id);
  },

  /** New credentials make the connection unverified again until a login succeeds. */
  async update(userId: number, id: number, body: UpdateConnectionBody) {
    const existing = await prisma.financialConnection.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("החיבור לא נמצא");
    const provider = providerInfo(existing.provider);
    if (!provider) throw ApiError.badRequest("ספק החיבור אינו נתמך");
    if (provider.kind === "bank" && body.bankAccountId !== undefined) await requireBankAccount(userId, body.bankAccountId);
    await prisma.financialConnection.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label.trim() || provider.name } : {}),
        ...(body.bankAccountId !== undefined && provider.kind === "bank" ? { bankAccountId: body.bankAccountId } : {}),
        ...(body.accountHint !== undefined ? { accountHint: body.accountHint.trim() || null } : {}),
        ...(body.credentials ? { credentials: sealCredentials(userId, requiredCredentials(provider, body.credentials)), verifiedAt: null } : {}),
      },
    });
    return owned(userId, id);
  },

  async remove(userId: number, id: number) {
    await owned(userId, id);
    await prisma.financialConnection.delete({ where: { id } });
  },
};
