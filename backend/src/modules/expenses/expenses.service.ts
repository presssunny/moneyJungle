import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, sumDecimals } from "../../utils/money.utils";
import { expensesRepository } from "./expenses.repository";
import { CreateExpenseBody, UpdateExpenseBody } from "./expenses.validation";

type ExpenseRecord = Awaited<ReturnType<typeof expensesRepository.findByMonth>>[number];

const serialize = (expense: ExpenseRecord) => ({
  ...expense,
  amount: decimalToNumber(expense.amount),
});

export const expensesService = {
  async list(userId: number, year: number, month: number, categoryId?: number) {
    const { start, end } = monthRange(year, month);
    const expenses = await expensesRepository.findByMonth(userId, start, end, categoryId);
    return {
      expenses: expenses.map(serialize),
      total: sumDecimals(expenses.map((e) => e.amount)),
    };
  },

  create(userId: number, body: CreateExpenseBody) {
    return expensesRepository.create(userId, {
      amount: body.amount,
      categoryId: body.categoryId ?? null,
      paymentMethodId: body.paymentMethodId ?? null,
      businessName: body.businessName ?? null,
      description: body.description ?? null,
      expenseDate: body.expenseDate,
      isRecurring: body.isRecurring ?? false,
      source: "manual",
    });
  },

  async update(userId: number, id: number, body: UpdateExpenseBody) {
    const existing = await expensesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההוצאה לא נמצאה");
    return expensesRepository.update(id, body);
  },

  async remove(userId: number, id: number) {
    const existing = await expensesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההוצאה לא נמצאה");
    await expensesRepository.delete(id);
  },
};
