import { prisma } from "../../config/database";
import { accountBalanceService } from "../bank/accountBalance.service";
import { businessDate, fingerprint, nextDate } from "./journey.utils";
import { commitments } from "./commitments.service";
import { review } from "./review.service";
import { calculateAllowance } from "./allowance";
export async function getProfile(userId: number) {
  return prisma.financialProfile.upsert({ where: { userId }, update: {}, create: { userId, onboarding: "pending" } });
}
export async function financialStatus(userId: number) {
  const today = businessDate();
  const [profile, accounts, cards, events, issues, pendingDates, expenses, incomes, bankRows, creditRows, financing] = await Promise.all([
    getProfile(userId), prisma.bankAccount.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.creditCard.findMany({ where: { userId }, orderBy: { id: "asc" } }), commitments(userId), review(userId),
    prisma.creditTransaction.count({ where: { userId, creditImport: { status: "confirmed" }, OR: [{ chargeDate: null }, { cardId: null }] } }),
    prisma.expense.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.income.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.bankTransaction.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.creditTransaction.findMany({ where: { userId, creditImport: { status: "confirmed" } }, select: { id: true, amount: true, cardId: true, chargeDate: true, transactionType: true, updatedAt: true }, orderBy: { id: "asc" } }),
    prisma.creditTransaction.count({ where: { userId, creditImport: { status: "confirmed" }, transactionType: "financing" } }),
  ]);
  const balances = await Promise.all(accounts.map(async a => ({ id: a.id, name: a.accountName, ...(await accountBalanceService.derive(userId, a.id)) })));
  const statements = await prisma.bankStatementImport.findMany({ where: { userId }, orderBy: { id: "asc" } });
  const sources = [
    ...balances.map(b => {
      const reports = statements.filter(s => s.bankAccountId === b.id);
      return { key: `bank:${b.id}`, name: b.name, kind: "bank", asOf: b.anchor?.coverageTo ?? null,
        reportedFrom: null, reportedTo: null,
        observedFrom: reports.length ? reports.map(s => s.coverageFrom.toISOString().slice(0, 10)).sort()[0] : null,
        observedTo: reports.length ? reports.map(s => s.coverageTo.toISOString().slice(0, 10)).sort().at(-1)! : null,
        revision: fingerprint({ account: accounts.find(a => a.id === b.id), reports, rows: bankRows.filter(r => r.bankAccountId === b.id) }),
        limitation: "טווח התנועות אינו הוכחת רציפות. האישור כולל בדיקת דוחות חסרים ותשלומים שכבר נכללו ביתרה." };
    }),
    ...cards.map(c => ({ key: `credit:${c.id}`, name: c.name, kind: "credit", asOf: null,
      reportedFrom: null, reportedTo: null, observedFrom: null, observedTo: null,
      revision: fingerprint({ card: c, rows: creditRows.filter(r => r.cardId === c.id) }),
      limitation: "יש לבדוק שכל הדוחות והחיובים העתידיים של הכרטיס נרשמו; קובץ אחרון לבדו אינו כיסוי מלא." })),
  ];
  const dataVersion = fingerprint({ revision: profile.revision, balances, cards, events, issues, pendingDates, expenses, incomes, bankRows, creditRows, sources, scope: profile.scope, reserves: [profile.cashBuffer, profile.essentialReserve, profile.savedReserve] });
  const coverage = profile.coverage as { date?: string; dataVersion?: string; sources?: Array<{ key: string; revision: string }> } | null;
  const blockers: string[] = [];
  if (!profile.scope) blockers.push("יש לאשר אילו מקורות כלולים בתמונה הפיננסית");
  if (!accounts.length) blockers.push("אין יתרת בנק מאומתת לתכנון מזומן");
  if (balances.some(b => b.anchor?.coverageTo !== today)) blockers.push("נדרשת יתרה מאומתת להיום בכל חשבון בנק");
  if (issues.some(i => i.blocking)) blockers.push("נותרו קליטות או תנועות המחייבות בדיקה");
  if (pendingDates) blockers.push("יש עסקאות אשראי ללא מועד חיוב או כרטיס — לא ניתן לקבוע התחייבות מלאה");
  if (financing) blockers.push("יש עסקאות מימון שטרם הותאמו להתחייבות ההחזר — לא ניתן לקבוע את סכום התשלום המלא");
  if (events.some(e => !e.decision || (e.amount === null && e.decision === "unpaid"))) blockers.push("יש להשלים סכומים ולבדוק אילו התחייבויות כבר שולמו או חופפות");
  if (coverage?.date !== today || coverage.dataVersion !== dataVersion) blockers.push("יש לאשר שהמקורות וההתחייבויות מעודכנים להיום");
  if (sources.some(s => !coverage?.sources?.some(c => c.key === s.key && c.revision === s.revision))) blockers.push("יש לבדוק ולאשר עדכניות לכל חשבון וכרטיס בנפרד");
  // Cash on a different account is not proof that the debit account can pay.
  if (accounts.length > 1) blockers.push("תכנון יומי משולב לכמה חשבונות אינו זמין בלי הקצאת החיובים לחשבון המשלם");
  const end = new Date(Date.UTC(Number(today.slice(0,4)), Number(today.slice(5,7)), 0)).toISOString().slice(0,10);
  const dates: string[] = []; for (let d=today; d<=end; d=nextDate(d,1)) dates.push(d);
  const unpaid = events.filter(e => e.decision === "unpaid" && e.amount !== null);
  const futureCardReserve = unpaid.filter(e => e.kind === "credit" && e.date > end).reduce((s,e)=>s+Math.max(0,e.amount!),0);
  const cash = balances.reduce((sum,b)=>sum+b.balance,0);
  const reserves = Number(profile.cashBuffer) + Number(profile.savedReserve) + futureCardReserve;
  const calculated = calculateAllowance(cash, reserves, Number(profile.essentialReserve), dates, unpaid.filter(e=>e.date<=end).map(e=>({date:e.date,amount:Math.max(0,e.amount!)})));
  return { today, end, dataVersion, profile, sources, balances, cards, events, issues, blockers,
    allowance: { amount: blockers.length ? null : calculated.daily, shortfall: blockers.length ? null : calculated.shortfall,
      state: blockers.length ? "unavailable" : "provisional", cash, reserves, essentialReserve: Number(profile.essentialReserve),
      formula: "בכל יום נבדקת היתרה לאחר כרית הביטחון, החיסכון ששוריין, חיובי אשראי עתידיים, התחייבויות שטרם שולמו והוצאות חיוניות. התקציב היומי הוא הנמוך מבין הסכומים האפשריים לאורך התקופה, כולל היום.",
      assumptions: ["לפי המקורות הרשומים ואישור העדכניות שלך; ייתכנו הוצאות שלא נרשמו", "הכנסה שטרם התקבלה אינה נכללת", "חיוב שכבר שולם אינו מנוכה שוב מהיתרה", "האומדן הוא לתכנון יומי עד סוף החודש ואינו הבטחה ליתרה בבנק"] } };
}
