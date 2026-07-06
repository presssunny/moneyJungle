import { ApiError } from "../../utils/ApiError";
import { categoriesRepository } from "./categories.repository";
import {
  CreateCategoryBody,
  CreateRuleBody,
  UpdateCategoryBody,
  UpdateRuleBody,
} from "./categories.validation";

export const categoriesService = {
  list(userId: number, type?: string) {
    return categoriesRepository.findAll(userId, type);
  },

  create(userId: number, body: CreateCategoryBody) {
    return categoriesRepository.create(userId, {
      name: body.name,
      type: body.type,
      color: body.color ?? null,
      icon: body.icon ?? null,
    });
  },

  async update(userId: number, id: number, body: UpdateCategoryBody) {
    const existing = await categoriesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("הקטגוריה לא נמצאה");
    return categoriesRepository.update(id, body);
  },

  async remove(userId: number, id: number) {
    const existing = await categoriesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("הקטגוריה לא נמצאה");
    if (existing.isDefault) {
      throw ApiError.badRequest("לא ניתן למחוק קטגוריית ברירת מחדל");
    }
    await categoriesRepository.delete(id);
  },

  listRules(userId: number) {
    return categoriesRepository.findAllRules(userId);
  },

  async createRule(userId: number, body: CreateRuleBody) {
    const category = await categoriesRepository.findById(userId, body.categoryId);
    if (!category) throw ApiError.badRequest("הקטגוריה לא נמצאה");
    return categoriesRepository.createRule(userId, body);
  },

  async updateRule(userId: number, id: number, body: UpdateRuleBody) {
    const existing = await categoriesRepository.findRuleById(userId, id);
    if (!existing) throw ApiError.notFound("החוק לא נמצא");
    if (body.categoryId !== undefined) {
      const category = await categoriesRepository.findById(userId, body.categoryId);
      if (!category) throw ApiError.badRequest("הקטגוריה לא נמצאה");
    }
    return categoriesRepository.updateRule(id, body);
  },

  async removeRule(userId: number, id: number) {
    const existing = await categoriesRepository.findRuleById(userId, id);
    if (!existing) throw ApiError.notFound("החוק לא נמצא");
    await categoriesRepository.deleteRule(id);
  },
};
