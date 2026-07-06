import { prisma } from "../../config/database";
import { Prisma } from "../../../generated/prisma/client";
import { Theme } from "../../../generated/prisma/enums";
import { UpdateSettingsBody } from "./settings.validation";

type SettingsRecord = NonNullable<Awaited<ReturnType<typeof prisma.settings.findUnique>>>;

function themeToApi(theme: Theme): string {
  return theme.replaceAll("_", "-");
}

function themeToDb(theme: string): Theme {
  return theme.replaceAll("-", "_") as Theme;
}

function serialize(settings: SettingsRecord) {
  return { ...settings, theme: themeToApi(settings.theme) };
}

export const settingsService = {
  async get(userId: number) {
    const settings =
      (await prisma.settings.findUnique({ where: { userId } })) ??
      (await prisma.settings.create({ data: { userId } }));
    return serialize(settings);
  },

  async update(userId: number, body: UpdateSettingsBody) {
    await this.get(userId); // ensure the row exists
    const data = {
      ...(body.theme !== undefined && { theme: themeToDb(body.theme) }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.activeMonth !== undefined && { activeMonth: body.activeMonth }),
      ...(body.language !== undefined && { language: body.language }),
      ...(body.dateFormat !== undefined && { dateFormat: body.dateFormat }),
      ...(body.notificationsJson !== undefined && {
        notificationsJson: (body.notificationsJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      }),
    };
    const settings = await prisma.settings.update({ where: { userId }, data });
    return serialize(settings);
  },
};
