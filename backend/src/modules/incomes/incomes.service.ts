import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, sumDecimals } from "../../utils/money.utils";
import { incomesRepository } from "./incomes.repository";
import { CreateIncomeBody, UpdateIncomeBody } from "./incomes.validation";

type IncomeRecord = NonNullable<Awaited<ReturnType<typeof incomesRepository.findById>>>;

const serialize = (income: IncomeRecord) => ({
  ...income,
  amount: decimalToNumber(income.amount),
});

export const incomesService = {
  async list(userId: number, year: number, month: number) {
    const { start, end } = monthRange(year, month);
    const incomes = await incomesRepository.findByMonth(userId, start, end);
    return {
      incomes: incomes.map(serialize),
      total: sumDecimals(incomes.map((i) => i.amount)),
    };
  },

  create(userId: number, body: CreateIncomeBody) {
    return incomesRepository
      .create(userId, {
        amount: body.amount,
        type: body.type,
        description: body.description ?? null,
        incomeDate: body.incomeDate,
        isRecurring: body.isRecurring ?? false,
      })
      .then(serialize);
  },

  async update(userId: number, id: number, body: UpdateIncomeBody) {
    const existing = await incomesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההכנסה לא נמצאה");
    return incomesRepository.update(id, body).then(serialize);
  },

  async remove(userId: number, id: number) {
    const existing = await incomesRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההכנסה לא נמצאה");
    await incomesRepository.delete(id);
  },
};
