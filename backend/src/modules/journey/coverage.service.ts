import { prisma } from "../../config/database";
import { accountBalanceService } from "../bank/accountBalance.service";
import { businessDate, fingerprint, nextDate } from "./journey.utils";
import { commitments } from "./commitments.service";
import { review } from "./review.service";
import { buildPicture, situationOf } from "./picture.service";
import { accountDeficit, calculateAllowance, type CashObligation } from "./allowance";
import { sourceKeyOf } from "./funding.service";
async function hasPriorFinancialActivity(userId: number): Promise<boolean> {
  const [expense, income, bankTx, creditTx] = await Promise.all([
    prisma.expense.findFirst({ where: { userId }, select: { id: true } }),
    prisma.income.findFirst({ where: { userId }, select: { id: true } }),
    prisma.bankTransaction.findFirst({ where: { userId }, select: { id: true } }),
    prisma.creditTransaction.findFirst({ where: { userId }, select: { id: true } }),
  ]);
  return Boolean(expense || income || bankTx || creditTx);
}
// A user with financial activity from before onboarding ever ran must not be
// forced through it as if new, nor be assumed to have reviewed coverage they
// never saw — their first profile row starts `legacy`, not `pending`.
export async function getProfile(userId: number) {
  const existing = await prisma.financialProfile.findUnique({ where: { userId } });
  if (existing) return existing;
  const legacy = await hasPriorFinancialActivity(userId);
  return prisma.financialProfile.upsert({ where: { userId }, update: {}, create: { userId, onboarding: legacy ? "legacy" : "pending" } });
}
export interface PlannedTransfer { accountId: number; name: string; amount: number; date: string }
interface PlannedObligation { key: string; name: string; date: string; amount: number }

/**
 * Several accounts (banker ruling 2026-09-26): only the chosen spending account's own
 * cash is spendable; every obligation needs a confirmed paying account; another
 * account's shortfall becomes a transfer the spending account owes, and its surplus
 * is never counted. Blockers are pushed onto the caller's list.
 */
function planAcrossAccounts(input: {
  profile: { spendingAccountId: number | null; savedReserve: unknown; savedReserveLocation: string | null };
  balances: Array<{ id: number; name: string; balance: number; anchor: { coverageTo: string } | null }>;
  unpaid: Array<{ key: string; name: string; date: string; amount: number | null; kind: string }>;
  fundingRows: Array<{ sourceKey: string; bankAccountId: number }>;
  today: string; end: string; dates: string[]; blockers: string[];
}) {
  const { profile, balances, unpaid, today, end, dates, blockers } = input;
  const payer = new Map(input.fundingRows.map(r => [r.sourceKey, r.bankAccountId]));
  const spending = balances.find(b => b.id === profile.spendingAccountId);
  const empty = { cashInPlan: 0, savedReserveCounted: 0, obligations: [] as PlannedObligation[], transfers: [] as PlannedTransfer[] };
  if (!spending) { blockers.push("יש לבחור את החשבון שממנו יוצאות ההוצאות השוטפות, כדי לתכנן כשיש כמה חשבונות"); return empty; }
  const savedReserve = Number(profile.savedReserve);
  if (savedReserve > 0 && !profile.savedReserveLocation) blockers.push("יש לציין באיזה חשבון מוחזק החיסכון ששוריין");
  const relevant = unpaid.filter(e => e.date <= end || e.kind === "credit").map(e => ({ key: e.key, name: e.name, date: e.date, amount: Math.max(0, e.amount!), accountId: payer.get(sourceKeyOf(e.key) ?? "") }));
  const unassigned = relevant.filter(o => o.accountId === undefined);
  if (unassigned.length) blockers.push(`לא נקבע חשבון משלם ל: ${[...new Set(unassigned.map(o => o.name))].slice(0, 3).join(", ")}${unassigned.length > 3 ? " ועוד" : ""}`);
  const needAnchor = new Set([spending.id, ...relevant.map(o => o.accountId).filter((id): id is number => id !== undefined)]);
  const stale = balances.filter(b => needAnchor.has(b.id) && b.anchor?.coverageTo !== today);
  if (stale.length) blockers.push(`נדרשת יתרה מאומתת להיום בחשבון: ${stale.map(b => b.name).join(", ")}`);
  const transfers: PlannedTransfer[] = [];
  for (const other of balances.filter(b => b.id !== spending.id && needAnchor.has(b.id))) {
    const own = relevant.filter(o => o.accountId === other.id);
    const inPeriod: CashObligation[] = own.filter(o => o.date <= end).map(o => ({ date: o.date, amount: o.amount }));
    const after = own.filter(o => o.date > end).reduce((sum, o) => sum + o.amount, 0);
    const deficit = accountDeficit(other.balance, dates, inPeriod, after);
    if (deficit.amount > 0 && deficit.date) transfers.push({ accountId: other.id, name: other.name, amount: deficit.amount, date: deficit.date });
  }
  return {
    cashInPlan: spending.balance,
    savedReserveCounted: profile.savedReserveLocation === "spending" ? savedReserve : 0,
    obligations: relevant.filter(o => o.accountId === spending.id).map(({ accountId: _accountId, ...o }) => o),
    transfers,
  };
}

export async function financialStatus(userId: number) {
  const today = businessDate();
  const [profile, accounts, cards, events, issues, pendingDates, expenses, incomes, bankRows, creditRows, financing, loans, sessions, fundingRows] = await Promise.all([
    getProfile(userId), prisma.bankAccount.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.creditCard.findMany({ where: { userId }, orderBy: { id: "asc" } }), commitments(userId), review(userId),
    prisma.creditTransaction.count({ where: { userId, creditImport: { status: "confirmed" }, OR: [{ chargeDate: null }, { cardId: null }] } }),
    prisma.expense.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.income.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.bankTransaction.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.creditTransaction.findMany({ where: { userId, creditImport: { status: "confirmed" } }, select: { id: true, amount: true, cardId: true, chargeDate: true, transactionType: true, updatedAt: true, transactionDate:true, creditImport:{select:{importMonth:true,importYear:true}} }, orderBy: { id: "asc" } }),
    prisma.creditTransaction.count({ where: { userId, creditImport: { status: "confirmed" }, transactionType: "financing" } }),
    prisma.loan.findMany({where:{userId,status:"active"},include:{schedule:{orderBy:{paymentDate:"asc"}}},orderBy:{id:"asc"}}),
    prisma.importSession.findMany({where:{userId},select:{id:true,fileName:true,status:true}}),
    prisma.fundingAssignment.findMany({ where: { userId }, select: { sourceKey: true, bankAccountId: true }, orderBy: { sourceKey: "asc" } }),
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
      reportedFrom: null, reportedTo: null, observedFrom: creditRows.filter(r=>r.cardId===c.id).map(r=>r.transactionDate.toISOString().slice(0,10)).sort()[0]??null, observedTo: creditRows.filter(r=>r.cardId===c.id).map(r=>r.transactionDate.toISOString().slice(0,10)).sort().at(-1)??null,
      revision: fingerprint({ card: c, rows: creditRows.filter(r => r.cardId === c.id) }),
      limitation: "יש לבדוק שכל הדוחות והחיובים העתידיים של הכרטיס נרשמו; קובץ אחרון לבדו אינו כיסוי מלא." })),
    ...loans.map(l=>({key:`loan:${l.id}`,name:l.loanName,kind:"loan",asOf:null,reportedFrom:null,reportedTo:null,observedFrom:l.schedule[0]?.paymentDate.toISOString().slice(0,10)??null,observedTo:l.schedule.at(-1)?.paymentDate.toISOString().slice(0,10)??null,revision:fingerprint(l),limitation:"לוח התשלומים מתאר את הצפוי. תשלום נחשב שבוצע רק לאחר בדיקה."})),
    ...(situationOf(profile.situation)?.cashActivity||expenses.some(e=>["manual","recurring"].includes(e.source))?[{key:"manual",name:"מזומן והוצאות נוספות",kind:"manual",asOf:null,reportedFrom:null,reportedTo:null,observedFrom:null,observedTo:null,revision:fingerprint(expenses.filter(e=>["manual","recurring"].includes(e.source))),limitation:"נכללות רק הוצאות שנרשמו. יש לבדוק שלא נרשמו שוב רכישות שכבר מופיעות באשראי."}]:[]),
    ...(incomes.length?[{key:"income",name:"הכנסות",kind:"income",asOf:null,reportedFrom:null,reportedTo:null,observedFrom:null,observedTo:null,revision:fingerprint(incomes),limitation:"יש לבדוק הכנסות שטרם נרשמו; הכנסה צפויה אינה כסף שכבר התקבל."}]:[]),
  ];
  const dataVersion = fingerprint({ revision: profile.revision, balances, cards, events, issues, pendingDates, expenses, incomes, bankRows, creditRows, sources, scope: profile.scope, situation:profile.situation, reserves: [profile.cashBuffer, profile.essentialReserve, profile.savedReserve],
    funding: [profile.spendingAccountId, profile.savedReserveLocation, fundingRows] });
  const coverage = profile.coverage as { date?: string; dataVersion?: string; quietSourceKeys?:string[]; sources?: Array<{ key: string; revision: string }> } | null;
  const blockers: string[] = [];
  if (!profile.scope) blockers.push("יש לאשר אילו מקורות כלולים בתמונה הפיננסית");
  if (!accounts.length) blockers.push("אין יתרת בנק מאומתת לתכנון מזומן");
  const multiAccount = accounts.length > 1;
  if (!multiAccount && balances.some(b => b.anchor?.coverageTo !== today)) blockers.push("נדרשת יתרה מאומתת להיום בכל חשבון בנק");
  if (issues.some(i => i.blocking)) blockers.push("נשארו דוחות או תנועות שצריך לבדוק");
  if (pendingDates) blockers.push("יש עסקאות אשראי ללא מועד חיוב או כרטיס — לא ניתן לקבוע התחייבות מלאה");
  if (financing) blockers.push("יש עסקאות מימון שטרם הותאמו להתחייבות ההחזר — לא ניתן לקבוע את סכום התשלום המלא");
  if (events.some(e => !e.decision || (e.amount === null && e.decision === "unpaid"))) blockers.push("יש להשלים סכומים ולבדוק אילו התחייבויות כבר שולמו או חופפות");
  const coverageStale = coverage?.date !== today || coverage.dataVersion !== dataVersion;
  const coverageSourcesStale = sources.some(s => !coverage?.sources?.some(c => c.key === s.key && c.revision === s.revision));
  if (coverageStale) blockers.push("יש לאשר שהמקורות וההתחייבויות מעודכנים להיום");
  if (coverageSourcesStale) blockers.push("יש לבדוק ולאשר עדכניות לכל חשבון וכרטיס בנפרד");
  const end = new Date(Date.UTC(Number(today.slice(0,4)), Number(today.slice(5,7)), 0)).toISOString().slice(0,10);
  const dates: string[] = []; for (let d=today; d<=end; d=nextDate(d,1)) dates.push(d);
  const unpaid = events.filter(e => e.decision === "unpaid" && e.amount !== null);
  const cash = balances.reduce((sum,b)=>sum+b.balance,0);
  const plan = multiAccount ? planAcrossAccounts({ profile, balances, unpaid, fundingRows, today, end, dates, blockers })
    : { cashInPlan: cash, savedReserveCounted: Number(profile.savedReserve), obligations: unpaid.filter(e=>e.date<=end||e.kind==="credit").map(e=>({ key: e.key, name: e.name, date: e.date, amount: Math.max(0,e.amount!) })), transfers: [] as PlannedTransfer[] };
  const futureCardReserve = plan.obligations.filter(o => o.key.startsWith("credit:") && o.date > end).reduce((s,o)=>s+o.amount,0);
  const reserves = Number(profile.cashBuffer) + plan.savedReserveCounted + futureCardReserve;
  const calculated = calculateAllowance(plan.cashInPlan, reserves, Number(profile.essentialReserve), dates, [
    ...plan.obligations.filter(o=>o.date<=end).map(o=>({date:o.date,amount:o.amount})),
    ...plan.transfers.map(t=>({date:t.date,amount:t.amount})),
  ]);
  // The one authoritative signal that the user has actually seen and confirmed
  // the current coverage/limitations summary — not a client-supplied boolean.
  const coverageAcknowledged = !coverageStale && !coverageSourcesStale;
  const state = { today, end, hasActivity: Boolean(expenses.length || incomes.length || bankRows.length || creditRows.length), dataVersion, profile, sources, balances, cards, events, issues, blockers, coverageAcknowledged,
    allowance: { limitingDate: blockers.length ? null : calculated.limitingDate, amount: blockers.length ? null : calculated.daily, shortfall: blockers.length ? null : calculated.shortfall,
      state: blockers.length ? "unavailable" : "provisional", cash, reserves, essentialReserve: Number(profile.essentialReserve),
      /** The cash the calculation starts from: every account's with one account, the spending account's with several. */
      cashInPlan: plan.cashInPlan, savedReserveCounted: plan.savedReserveCounted,
      obligations: plan.obligations, transfers: plan.transfers, spendingAccountId: multiAccount ? profile.spendingAccountId : null,
      formula: "בכל יום נבדקת היתרה לאחר כרית הביטחון, החיסכון ששוריין, חיובי אשראי עתידיים, התחייבויות שטרם שולמו והוצאות חיוניות. התקציב היומי הוא הנמוך מבין הסכומים האפשריים לאורך התקופה, כולל היום.",
      assumptions: ["לפי המקורות הרשומים ואישור העדכניות שלך; ייתכנו הוצאות שלא נרשמו", "הכנסה שטרם התקבלה אינה נכללת", "חיוב שכבר שולם אינו מנוכה שוב מהיתרה", "האומדן הוא לתכנון יומי עד סוף החודש ואינו הבטחה ליתרה בבנק"] } };
  const quietSourceKeys=coverageAcknowledged?coverage?.quietSourceKeys??[]:[];
  const picture=buildPicture({...state,quietSourceKeys},{bankRows,creditRows,expenses,incomes,loans,sessions});
  if(picture.requiredGaps.length){
    state.blockers.push(...picture.requiredGaps);
    state.allowance={...state.allowance,amount:null,shortfall:null,limitingDate:null,state:"unavailable"};
  }
  return {...state,quietSourceKeys,picture};

}
