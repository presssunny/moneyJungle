import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreateFamilyMemberBody, UpdateFamilyMemberBody } from "./family.validation";

export const familyService = {
  list() {
    return prisma.user.findMany({
      orderBy: { id: "asc" },
      include: {
        _count: { select: { expenses: true, incomes: true, loans: true } },
      },
    });
  },

  create(body: CreateFamilyMemberBody) {
    return prisma.user.create({ data: { name: body.name } });
  },

  async update(id: number, body: UpdateFamilyMemberBody) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound("בן המשפחה לא נמצא");
    return prisma.user.update({ where: { id }, data: body });
  },

  async remove(id: number, currentUserId: number) {
    if (id === currentUserId) throw ApiError.badRequest("אי אפשר למחוק את המשתמש הפעיל");
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound("בן המשפחה לא נמצא");
    await prisma.user.delete({ where: { id } });
  },
};
