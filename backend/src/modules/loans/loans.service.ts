import { ApiError } from "../../utils/ApiError";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import { amortizationSchedule, computeLoan } from "./loanCalculator.service";
import { loansRepository } from "./loans.repository";
import { CreateLoanBody, UpdateLoanBody } from "./loans.validation";

type LoanRecord = NonNullable<Awaited<ReturnType<typeof loansRepository.findById>>>;

/** Flatten decimals to numbers and attach derived Spitzer values. */
function serializeLoan(loan: LoanRecord) {
  const currentBalance = decimalToNumber(loan.currentBalance);
  const annualInterestRate = decimalToNumber(loan.annualInterestRate);
  const monthlyPayment = decimalToNumber(loan.monthlyPayment);
  return {
    ...loan,
    originalAmount: decimalToNumber(loan.originalAmount),
    currentBalance,
    annualInterestRate,
    monthlyPayment,
    earlyRepaymentFee:
      loan.earlyRepaymentFee === null ? null : decimalToNumber(loan.earlyRepaymentFee),
    computed: computeLoan({ currentBalance, annualInterestRate, monthlyPayment }),
  };
}

export const loansService = {
  async list(userId: number) {
    const loans = await loansRepository.findAll(userId);
    const items = loans.map(serializeLoan);

    const active = items.filter((loan) => loan.status === "active");
    const totals = {
      totalBalance: round2(active.reduce((sum, l) => sum + l.currentBalance, 0)),
      monthlyPayment: round2(active.reduce((sum, l) => sum + l.monthlyPayment, 0)),
      monthlyInterest: round2(active.reduce((sum, l) => sum + l.computed.monthlyInterestPayment, 0)),
      annualInterest: round2(active.reduce((sum, l) => sum + l.computed.estimatedAnnualInterest, 0)),
      activeCount: active.length,
    };
    return { loans: items, totals };
  },

  create(userId: number, body: CreateLoanBody) {
    return loansRepository
      .create(userId, {
        loanName: body.loanName,
        loanType: body.loanType,
        lenderName: body.lenderName ?? null,
        originalAmount: body.originalAmount,
        currentBalance: body.currentBalance,
        annualInterestRate: body.annualInterestRate,
        monthlyPayment: body.monthlyPayment,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        isIndexLinked: body.isIndexLinked ?? false,
        earlyRepaymentFee: body.earlyRepaymentFee ?? null,
        status: body.status ?? "active",
      })
      .then(serializeLoan);
  },

  async update(userId: number, id: number, body: UpdateLoanBody) {
    const existing = await loansRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    return loansRepository.update(id, body).then(serializeLoan);
  },

  async remove(userId: number, id: number) {
    const existing = await loansRepository.findById(userId, id);
    if (!existing) throw ApiError.notFound("ההלוואה לא נמצאה");
    await loansRepository.delete(id);
  },

  /** Month-by-month payoff schedule for charts. */
  async schedule(userId: number, id: number) {
    const loan = await loansRepository.findById(userId, id);
    if (!loan) throw ApiError.notFound("ההלוואה לא נמצאה");
    return amortizationSchedule({
      currentBalance: decimalToNumber(loan.currentBalance),
      annualInterestRate: decimalToNumber(loan.annualInterestRate),
      monthlyPayment: decimalToNumber(loan.monthlyPayment),
    });
  },
};
