import { prisma } from "../../config/database";
import { decimalToNumber } from "../../utils/money.utils";

export interface SearchItem {
  key: string;
  label: string;
  detail: string | null;
  amount: number | null;
  date: string | null;
  to: string;
}

export interface SearchGroup {
  kind: "expenses" | "incomes" | "credit" | "documents" | "loans" | "goals";
  label: string;
  items: SearchItem[];
}

const PER_GROUP = 5;
const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;
const month = (date: Date) => date.toISOString().slice(0, 7);

/** Owner-scoped lookup of records by their own names. It reads, never ranks money, and leaves every total to its source. */
export async function searchRecords(userId: number, query: string): Promise<SearchGroup[]> {
  const contains = query.trim();
  const [expenses, incomes, credit, documents, loans, goals] = await Promise.all([
    prisma.expense.findMany({ where: { userId, OR: [{ businessName: { contains } }, { description: { contains } }] }, orderBy: [{ expenseDate: "desc" }, { id: "desc" }], take: PER_GROUP }),
    prisma.income.findMany({ where: { userId, description: { contains } }, orderBy: [{ incomeDate: "desc" }, { id: "desc" }], take: PER_GROUP }),
    prisma.creditTransaction.findMany({ where: { userId, businessName: { contains } }, include: { creditImport: { select: { status: true } } }, orderBy: [{ transactionDate: "desc" }, { id: "desc" }], take: PER_GROUP }),
    prisma.document.findMany({ where: { userId, fileName: { contains } }, orderBy: { uploadedAt: "desc" }, take: PER_GROUP }),
    prisma.loan.findMany({ where: { userId, OR: [{ loanName: { contains } }, { lenderName: { contains } }] }, orderBy: { id: "asc" }, take: PER_GROUP }),
    prisma.savingsGoal.findMany({ where: { userId, goalName: { contains } }, orderBy: { id: "asc" }, take: PER_GROUP }),
  ]);
  const groups: SearchGroup[] = [
    { kind: "expenses", label: "הוצאות", items: expenses.map((r) => {
      const name = r.businessName || r.description || "הוצאה";
      return { key: `expense:${r.id}`, label: name, detail: null, amount: decimalToNumber(r.amount), date: day(r.expenseDate),
        to: `/transactions?tab=expenses&month=${month(r.expenseDate)}&q=${encodeURIComponent(name)}` };
    }) },
    { kind: "incomes", label: "הכנסות", items: incomes.map((r) => ({ key: `income:${r.id}`, label: r.description || "הכנסה", detail: null,
      amount: decimalToNumber(r.amount), date: day(r.incomeDate), to: `/transactions?tab=incomes&month=${month(r.incomeDate)}` })) },
    { kind: "credit", label: "עסקאות אשראי", items: credit.map((r) => ({ key: `credit:${r.id}`, label: r.businessName,
      detail: r.creditImport.status === "confirmed" ? null : "בדוח שטרם אושר", amount: decimalToNumber(r.amount), date: day(r.transactionDate),
      to: `/accounts?tab=credit&importId=${r.creditImportId}` })) },
    { kind: "documents", label: "מסמכים", items: documents.map((r) => ({ key: `document:${r.id}`, label: r.fileName, detail: null,
      amount: null, date: day(r.uploadedAt), to: "/data" })) },
    { kind: "loans", label: "הלוואות", items: loans.map((r) => ({ key: `loan:${r.id}`, label: r.loanName, detail: r.lenderName,
      amount: r.status === "finished" ? 0 : decimalToNumber(r.currentBalance), date: null, to: "/accounts?tab=loans" })) },
    { kind: "goals", label: "יעדים", items: goals.map((r) => ({ key: `goal:${r.id}`, label: r.goalName, detail: null,
      amount: null, date: day(r.targetDate), to: "/accounts?tab=savings" })) },
  ];
  return groups.filter((group) => group.items.length > 0);
}
