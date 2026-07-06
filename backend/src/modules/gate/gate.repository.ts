import { prisma } from "../../config/database";

export const gateRepository = {
  createSession(tokenHash: string, expiresAt: Date) {
    return prisma.gateSession.create({ data: { tokenHash, expiresAt } });
  },

  findByTokenHash(tokenHash: string) {
    return prisma.gateSession.findUnique({ where: { tokenHash } });
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
