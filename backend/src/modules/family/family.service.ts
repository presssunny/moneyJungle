import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreateFamilyMemberBody, UpdateFamilyMemberBody } from "./family.validation";

/**
 * CRUD for `FamilyMember` — a household member associated with the
 * authenticated account, NOT a login of its own (see the FamilyMember model's
 * doc comment in schema.prisma). Every method is scoped by `userId`, the
 * *authenticated* account's id, so one account's household members are never
 * visible to — or editable by — another account.
 *
 * This used to create/edit/delete rows in the `User` table directly (the
 * account table itself), which is what made `relation` a dead field: it was
 * never part of the create/update payload written below, and there was no
 * column to hold it if it had been. Both are fixed by moving to the
 * FamilyMember model.
 */
export const familyService = {
  list(userId: number) {
    return prisma.familyMember.findMany({
      where: { userId },
      orderBy: { id: "asc" },
    });
  },

  create(userId: number, body: CreateFamilyMemberBody) {
    return prisma.familyMember.create({
      data: { userId, name: body.name, relation: body.relation ?? null },
    });
  },

  async update(userId: number, id: number, body: UpdateFamilyMemberBody) {
    const existing = await prisma.familyMember.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("בן המשפחה לא נמצא");
    return prisma.familyMember.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    const existing = await prisma.familyMember.findFirst({ where: { id, userId } });
    if (!existing) throw ApiError.notFound("בן המשפחה לא נמצא");
    await prisma.familyMember.delete({ where: { id } });
  },
};
