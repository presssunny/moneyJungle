import { ApiError } from "../../utils/ApiError";
import { remindersRepository } from "./reminders.repository";
import { CreateReminderBody, UpdateReminderBody } from "./reminders.validation";

const DEFAULT_ICONS: Record<string, string> = {
  birthday: "🎂",
  expected_expense: "🛍️",
  event: "📅",
  other: "🔔",
};

export const remindersService = {
  list(userId: number) {
    return remindersRepository.findAll(userId);
  },

  create(userId: number, body: CreateReminderBody) {
    return remindersRepository.create(userId, {
      title: body.title,
      description: body.description ?? null,
      eventDate: body.eventDate,
      estimatedAmount: body.estimatedAmount ?? null,
      type: body.type,
      icon: body.icon ?? DEFAULT_ICONS[body.type],
      isActive: body.isActive ?? true,
      userId,
    });
  },

  async update(userId: number, id: number, body: UpdateReminderBody) {
    const existing = await remindersRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("התזכורת לא נמצאה");
    return remindersRepository.update(id, body);
  },

  async remove(userId: number, id: number) {
    const existing = await remindersRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("התזכורת לא נמצאה");
    await remindersRepository.delete(id);
  },
};
