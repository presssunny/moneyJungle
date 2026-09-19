import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { CreateAssetBody, UpdateAssetBody } from "./assets.validation";

async function requireAsset(userId: number, id: number) {
  const asset = await prisma.asset.findFirst({ where: { id, userId } });
  if (!asset) throw ApiError.notFound("הנכס לא נמצא");
  return asset;
}

export const assetsService = {
  list(userId: number) {
    return prisma.asset.findMany({ where: { userId }, orderBy: { id: "asc" } });
  },

  create(userId: number, body: CreateAssetBody) {
    return prisma.asset.create({
      data: { userId, name: body.name, assetType: body.assetType, currentValue: body.currentValue, asOfDate: body.asOfDate },
    });
  },

  async update(userId: number, id: number, body: UpdateAssetBody) {
    await requireAsset(userId, id);
    return prisma.asset.update({ where: { id }, data: body });
  },

  async remove(userId: number, id: number) {
    await requireAsset(userId, id);
    await prisma.asset.delete({ where: { id } });
  },
};
