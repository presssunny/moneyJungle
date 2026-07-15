import { ApiError } from "../../utils/ApiError";
import { alertsRepository } from "./alerts.repository";
import { scanForAlerts } from "./alertsScanner.service";

export const alertsService = {
  async list(userId: number, onlyUnread = false) {
    await scanForAlerts(userId);
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
