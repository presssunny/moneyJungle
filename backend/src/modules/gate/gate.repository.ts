import { prisma } from "../../config/database";

export const gateRepository = {
  touchSession(id: number, lastSeenAt: Date) {
    return prisma.gateSession.updateMany({ where: { id }, data: { lastSeenAt } });
  },
  createSession(userId: number, tokenHash: string, expiresAt: Date) {
    return prisma.gateSession.create({ data: { userId, tokenHash, expiresAt } });
  },

  /**
   * Joins the owning user in one round trip — this is what lets gateAuth
   * resolve identity + role + status from the token alone, without a second
   * query, and without ever trusting anything the client supplied.
   */
  findByTokenHash(tokenHash: string) {
    return prisma.gateSession.findUnique({ where: { tokenHash }, include: { user: true } });
  },

  deleteByTokenHash(tokenHash: string) {
    return prisma.gateSession.deleteMany({ where: { tokenHash } });
  },

  deleteExpired() {
    return prisma.gateSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  },
};
