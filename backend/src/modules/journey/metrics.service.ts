import { prisma } from "../../config/database";
import { ApiError } from "../../utils/ApiError";
import { monthRange } from "../../utils/date.utils";
import { decimalToNumber, round2 } from "../../utils/money.utils";
import type { FinancialMetric, MetricComponent, MetricName } from "../../types/metric.types";
import { monthTotals } from "../dashboard/dashboard.service";
import { loansService } from "../loans/loans.service";
import { financialStatus } from "./coverage.service";

const pageSize = 50;
/** A page and its header are read under the same per-user transaction as Home.
 * Later pages require the first page's version so edits cannot mix snapshots. */
export async function financialMetric(userId: number, name: MetricName, month: string, page = 1, version?: string, card?: string): Promise<FinancialMetric> {
  const state = await financialStatus(userId);
  if (version && version !== state.dataVersion) throw ApiError.conflict("המקורות השתנו. יש לרענן את המספר ואת הפירוט");
  if (page > 1 && !version) throw ApiError.badRequest("נדרשת גרסת המקורות להמשך הפירוט");
  const [year, monthNumber] = month.split("-").map(Number);
  const { start, end } = monthRange(year, monthNumber);
  const monthly = ["income", "expense", "surplus"].includes(name);
  const metric: FinancialMetric = {
    name, value: null, currency: "ILS", state: "partial", asOf: state.today,
    period: monthly ? { from: start.toISOString().slice(0,10), to: new Date(end.getTime()-86400000).toISOString().slice(0,10) } : { from: state.today, to: state.end },
    sources: state.sources.map(s=>({key:s.key,label:s.name,to:"/data"})),
    coverage: "לפי המקורות הרשומים; עצם קיום התנועות אינו מוכיח כיסוי מלא",
    missingData: state.blockers, assumptions: [], formula: "", calculationVersion: "cash-v1/month-v1", dataVersion: state.dataVersion,
    components: [], total: 0, page, pageSize,
  };
  let components: MetricComponent[] = [];
  if (name === "creditCharge") {
    const where={userId,creditImport:{status:"confirmed" as const},transactionType:{not:"financing"},chargeDate:{gte:new Date(state.today)},...(card==="unassigned"?{cardId:null}:card&&card!=="all"?{cardId:Number(card)}:{})};
    const next=await prisma.creditTransaction.findFirst({where,orderBy:[{chargeDate:"asc"},{id:"asc"}]});
    metric.formula="עסקאות מאושרות למועד החיוב הקרוב, בניכוי זיכויים וללא מימון פנימי";
    metric.assumptions=["מועד הירידה הרשום בדוח; יום חיוב שהוגדר בכרטיס אינו תחליף", "עסקאות ללא תאריך חיוב ודוחות חסרים אינם נכללים; הסכום עשוי להיות חלקי"];
    if(!next?.chargeDate){metric.state="unavailable";metric.missingData.push("לא נמצא מועד חיוב עתידי בדוחות המאושרים");return metric;}
    const chargeWhere={...where,chargeDate:next.chargeDate};
    const [total,aggregate,rows]=await Promise.all([prisma.creditTransaction.count({where:chargeWhere}),prisma.creditTransaction.aggregate({where:chargeWhere,_sum:{amount:true}}),prisma.creditTransaction.findMany({where:chargeWhere,orderBy:{id:"asc"},skip:(page-1)*pageSize,take:pageSize,include:{card:true,creditImport:true}})]);
    metric.value=Number(aggregate._sum.amount);metric.total=total;
    metric.period={from:next.chargeDate.toISOString().slice(0,10),to:next.chargeDate.toISOString().slice(0,10)};
    metric.components=rows.map(row=>({key:`credit:${row.id}`,label:row.businessName,value:Number(row.amount),date:row.chargeDate!.toISOString().slice(0,10),detail:`${row.card?.name??"ללא כרטיס"} · ${row.creditImport.fileName}`,to:`/accounts?tab=credit&importId=${row.creditImportId}`}));
    metric.sources.push({key:"documents",label:"מסמכי המקור",to:"/documents"});
    return metric;
  }
  if (monthly) {
    const totals = await monthTotals(userId,year,monthNumber);
    metric.value = name === "income" ? totals.incomeTotal : name === "expense" ? totals.expenseTotal : round2(totals.incomeTotal-totals.expenseTotal);
    metric.state = "recorded";
    metric.formula = name === "surplus" ? "הכנסות רשומות פחות הוצאות רשומות" : name === "expense" ? "הוצאות רשומות ועוד אשראי מאושר ללא עסקאות מימון; זיכויים מקטינים את הסכום" : "סכום ההכנסות לפי תאריך ההכנסה";
    metric.assumptions = ["אשראי משויך לפי חודש העסקה בדוח, לא לפי מועד הירידה בבנק", "העברות, קרן הלוואה וחיובי כרטיס שכבר פורטו אינם הוצאה נוספת", "עודף חודשי אינו יתרת בנק ואינו כסף פנוי"];
    // Concatenate source streams in stable source/id order. Only the requested
    // 50 records are fetched, without loading the full monthly ledger.
    const expenseWhere = {userId,expenseDate:{gte:start,lt:end}};
    const creditWhere = {userId,billingDate:{gte:start,lt:end},transactionType:{not:"financing"},creditImport:{status:"confirmed" as const}};
    const incomeWhere = {userId,incomeDate:{gte:start,lt:end}};
    const counts = await Promise.all([
      name === "income" ? 0 : prisma.expense.count({where:expenseWhere}),
      name === "income" ? 0 : prisma.creditTransaction.count({where:creditWhere}),
      name === "expense" ? 0 : prisma.income.count({where:incomeWhere}),
    ]);
    metric.total = counts.reduce((a,b)=>a+b,0);
    let skip=(page-1)*pageSize;
    for (let source=0;source<3;source++) {
      if(skip>=counts[source]) {skip-=counts[source];continue;}
      const take=pageSize-metric.components.length;
      if(!take)break;
      if(source===0) metric.components.push(...(await prisma.expense.findMany({where:expenseWhere,orderBy:{id:"asc"},skip,take})).map(r=>({key:`expense:${r.id}`,label:r.businessName||r.description||"הוצאה",value:Number(r.amount)*(name==="surplus"?-1:1),date:r.expenseDate.toISOString().slice(0,10),detail:r.source??"manual",to:`/transactions?tab=expenses&month=${month}&q=${encodeURIComponent(r.businessName??r.description??"")}`})));
      if(source===1) metric.components.push(...(await prisma.creditTransaction.findMany({where:creditWhere,orderBy:{id:"asc"},skip,take})).map(r=>({key:`credit:${r.id}`,label:r.businessName,value:Number(r.amount)*(name==="surplus"?-1:1),date:r.billingDate.toISOString().slice(0,10),detail:"אשראי מאושר",to:`/accounts?tab=credit&importId=${r.creditImportId}`})));
      if(source===2) metric.components.push(...(await prisma.income.findMany({where:incomeWhere,orderBy:{id:"asc"},skip,take})).map(r=>({key:`income:${r.id}`,label:r.description||"הכנסה",value:Number(r.amount),date:r.incomeDate.toISOString().slice(0,10),to:`/transactions?tab=incomes&month=${month}`})));
      skip=0;
    }
    metric.sources.push({key:"ledger",label:"התנועות שנכללו בחודש",to:`/transactions?month=${month}&tab=${name==="income"?"incomes":"expenses"}`});
    return metric;
  }
  if (name === "cash") {
    metric.value = state.balances.length ? round2(state.allowance.cash) : null;
    metric.formula = "סכום יתרות החשבונות: עוגן אחרון ועוד תנועות מאוחרות ממנו";
    components=state.balances.flatMap(b=>[
      {key:`anchor:${b.id}`,label:`${b.name} — ${b.anchor?.fileName??"ללא עוגן מאומת"}`,value:b.anchor?.closingBalance??round2(b.balance-b.afterAnchorNet),date:b.anchor?.coverageTo,detail:b.explanation,to:"/accounts?tab=bank"},
      {key:`after:${b.id}`,label:`${b.name} — ${b.afterAnchorCount} תנועות אחרי העוגן`,value:b.afterAnchorNet,to:"/accounts?tab=bank"},
    ]);
    metric.assumptions=["רק תנועות עד היום נכללות; טווח תנועות בדוח אינו הוכחת רציפות", "יתרה ללא עוגן מאומת היא אומדן מיתרת הפתיחה והתנועות"];
  } else if (name === "commitments") {
    const open=state.events.filter(e=>e.decision!=="paid"&&e.decision!=="duplicate");
    metric.value=round2(open.reduce((sum,e)=>sum+(e.amount??0),0));
    if(open.some(e=>e.amount===null))metric.missingData=[...metric.missingData,"הסכום הוא חלקי: יש התחייבויות ללא סכום"];
    metric.formula="סכום ההתחייבויות הפתוחות הידועות, כולל פיגורים; שולם וכפילות אינם נספרים";
    metric.assumptions=["סכום לא ידוע אינו אפס; התחייבות בלי החלטה עדיין טעונה בדיקה"];
    components=state.events.map(e=>({key:e.key,label:e.name,value:e.decision==="paid"||e.decision==="duplicate"?0:e.amount,date:e.date,detail:e.decision==="paid"?"שולם — הוחרג":e.decision==="duplicate"?"כפילות — הוחרגה":e.decision==="unpaid"?"טרם שולם":"לבדיקה",to:e.to}));
    if(state.events.length)metric.period={from:state.events.map(e=>e.date).sort()[0],to:state.events.map(e=>e.date).sort().at(-1)!};
  } else if (name === "netWorth") {
    // A stock, not a flow: assets declared manually, minus active loan principal
    // (the same figure LoansPage shows) and card debt already charged but not
    // yet settled. Bank balance and savings goals are deliberately excluded —
    // that money is already inside the bank balance shown elsewhere (CLAUDE.md,
    // AccountsPage). Until every historical card bill has a decision, "unpaid"
    // can't be told apart from "already paid" — so the figure stays unavailable
    // rather than silently treating an undecided bill as zero debt.
    const cardBills = state.events.filter(e => e.kind === "credit");
    const undecided = cardBills.filter(e => !e.decision);
    const [assets, loanSummary] = await Promise.all([
      prisma.asset.findMany({ where: { userId }, orderBy: { id: "asc" } }),
      loansService.list(userId).then(r => r.summary),
    ]);
    metric.formula = "סכום הנכסים שנרשמו ידנית, בניכוי יתרת קרן ההלוואות הפעילות וחובות אשראי שנרשמו כטרם שולמו";
    metric.assumptions = [
      "נכס הוא ערך שנרשם ידנית לפי מועד עדכון — אינו מאומת מול מסמך חיצוני",
      "יתרת בנק ויעדי חיסכון אינם נכללים כנכס: הכסף עשוי כבר להיות בתוך יתרת הבנק",
      'חיוב "אשראי מתגלגל" אינו נכלל בחישוב ההתחייבויות',
    ];
    metric.sources.push({ key: "assets", label: "נכסים רשומים", to: "/accounts?tab=assets" });
    components = assets.map(a => ({ key: `asset:${a.id}`, label: a.name, value: decimalToNumber(a.currentValue), date: a.asOfDate.toISOString().slice(0, 10), detail: a.assetType, to: "/accounts?tab=assets" }));
    if (undecided.length) {
      metric.state = "unavailable";
      metric.missingData = [...metric.missingData, `יש ${undecided.length} חיובי אשראי היסטוריים ללא החלטה — לא ניתן לקבוע את שווי הנטו עד שיסומנו`];
    } else {
      const unpaidCardDebt = round2(cardBills.filter(e => e.decision === "unpaid" && e.amount !== null).reduce((s, e) => s + Math.max(0, e.amount!), 0));
      const liabilitiesTotal = round2(loanSummary.totalBalance + unpaidCardDebt);
      metric.value = round2(assets.reduce((s, a) => s + decimalToNumber(a.currentValue), 0) - liabilitiesTotal);
      metric.state = "provisional";
      components.push(
        { key: "loans", label: "יתרת קרן הלוואות פעילות", value: -loanSummary.totalBalance, to: "/accounts?tab=loans" },
        ...cardBills.filter(e => e.decision === "unpaid" && e.amount !== null).map(e => ({ key: e.key, label: e.name, value: -Math.max(0, e.amount!), date: e.date, detail: "חוב אשראי טרם שולם", to: e.to })),
      );
    }
  } else {
    metric.value=state.allowance.amount;
    metric.state=metric.value===null?"unavailable":"provisional";
    metric.formula=state.allowance.formula;
    metric.assumptions=[...state.allowance.assumptions, ...(state.allowance.limitingDate?[`היום המגביל: ${state.allowance.limitingDate}`]:[])];
    components=[
      {key:"cash",label:"יתרות בנק",value:state.balances.length?state.allowance.cash:null,to:"/accounts?tab=bank"},
      {key:"buffer",label:"כרית ביטחון",value:-Number(state.profile.cashBuffer),to:"/data"},
      {key:"saved",label:"חיסכון ששוריין",value:-Number(state.profile.savedReserve),to:"/data"},
      {key:"essential",label:"הוצאות חיוניות שנותרו — נפרסות על ימי התקופה",value:-state.allowance.essentialReserve,to:"/data"},
      ...state.events.filter(e=>e.decision==="unpaid"&&(e.date<=state.end||e.kind==="credit")).map(e=>({key:e.key,label:e.name,value:e.amount===null?null:-Math.max(0,e.amount),date:e.date,to:e.to})),
    ];
  }
  metric.total=components.length;
  metric.components=components.slice((page-1)*pageSize,page*pageSize);
  return metric;
}
