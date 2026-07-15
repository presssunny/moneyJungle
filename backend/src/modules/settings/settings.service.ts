import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { UpdateSettingsBody } from "./settings.validation";

export const settingsService = {
  async get(userId: number) {
    return (
      (await prisma.settings.findUnique({ where: { userId } })) ??
      (await prisma.settings.create({ data: { userId } }))
    );
  },

  async update(userId: number, body: UpdateSettingsBody) {
    await this.get(userId); // ensure the row exists
    const data = {
      ...(body.theme !== undefined && { theme: body.theme }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.activeMonth !== undefined && { activeMonth: body.activeMonth }),
      ...(body.language !== undefined && { language: body.language }),
      ...(body.dateFormat !== undefined && { dateFormat: body.dateFormat }),
      ...(body.notificationsJson !== undefined && {
        notificationsJson: (body.notificationsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      }),
    };
    return prisma.settings.update({ where: { userId }, data });
  },
};
