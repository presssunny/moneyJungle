import { ApiError } from "../../utils/ApiError";
import { alertsRepository } from "./alerts.repository";

export const alertsService = {
  list(userId: number, onlyUnread = false) {
    return alertsRepository.findAll(userId, onlyUnread);
  },

  async markRead(userId: number, id: number) {
    const alert = await alertsRepository.findById(userId, id);
    if (!alert) throw ApiError.notFound("ההתראה לא נמצאה");
    return alertsRepository.markRead(id);
  },

  markAllRead(userId: number) {
    return alertsRepository.markAllRead(userId);
  },

  async remove(userId: number, id: number) {
    const alert = await alertsRepository.findById(userId, id);
    if (!alert) throw ApiError.notFound("ההתראה לא נמצאה");
    await alertsRepository.delete(id);
  },
};
