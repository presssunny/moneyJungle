import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The API is mocked end to end. A loan seen only on the statement arrives with null
// balance/rate/original amount: it must read "חסר", never a 0 ₪ that looks paid off.
const base={loanType:'bank',lenderName:null,startDate:'2026-11-15',nextPaymentDate:'2026-11-15',startDateMeaning:'recorded',endDate:null,isIndexLinked:false,earlyRepaymentFee:null,status:'active',
 trackNumber:null,trackName:null,closedAt:null,closureReason:null,closureCost:null,scheduleImportedAt:null};
const known={...base,id:1,loanName:'הלוואת רכב',loanNumber:'201',originalAmount:50000,currentBalance:30000,annualInterestRate:5,monthlyPayment:1200,
 totalPayments:50,paymentsMade:20,scheduleSource:'bank_file',originalAmountSource:'contract',
 computed:{monthlyInterestRate:0.4167,monthlyInterestPayment:125,monthlyPrincipalPayment:1075,estimatedAnnualInterest:1500,remainingMonths:30,totalRemainingInterest:2000,isExpensive:false},
 progress:{lifecycle:'active',principalRepaid:20000,progressPercent:40,paymentsMade:20,paymentsRemaining:30,totalPayments:50,certainty:'measured'}};
const fromStatement={...base,id:2,loanName:'הלוואה 108',loanNumber:'108',originalAmount:null,currentBalance:null,annualInterestRate:null,monthlyPayment:1500,
 totalPayments:null,paymentsMade:null,scheduleSource:'statement',originalAmountSource:'unknown',computed:null,
 progress:{lifecycle:'active',principalRepaid:0,progressPercent:0,paymentsMade:null,paymentsRemaining:null,totalPayments:null,certainty:'scenario'}};
const noRate={...base,id:3,startDate:'2020-03-15',startDateMeaning:'opening',loanName:'הלוואה פרטית',loanType:'private',loanNumber:null,originalAmount:10000,currentBalance:8000,annualInterestRate:null,monthlyPayment:500,
 totalPayments:null,paymentsMade:null,scheduleSource:'computed',originalAmountSource:'manual',computed:null,
 progress:{lifecycle:'active',principalRepaid:2000,progressPercent:20,paymentsMade:null,paymentsRemaining:null,totalPayments:null,certainty:'measured'}};
const summary={activeCount:3,closedCount:0,totalBalance:38000,monthlyPayment:3200,monthlyInterest:125,annualInterest:1500,freedMonthlyPayment:0,closureCosts:0,
 endingSoonCount:0,hasScenarioProgress:false,unknownBalanceCount:1,unknownInterestCount:2};
const totals={totalBalance:38000,monthlyPayment:3200,monthlyInterest:125,annualInterest:1500,activeCount:3,unknownBalanceCount:1,unknownInterestCount:2};

async function mockApi(page:Page){
 const paths:string[]=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;paths.push(path);
  let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/bank/accounts')reply={accounts:[{id:1,bankName:'הבינלאומי',accountName:'עו״ש',currentBalance:'1000'}],totals:{totalBalance:1000,unknownBalanceCount:0}};
  else if(path==='/api/savings')reply={goals:[],summary:{savedTotal:0}};
  else if(path==='/api/loans')reply={loans:[known,fromStatement,noRate],summary,groups:[],events:[],fromStatement:null,totals};
  await route.fulfill({json:reply});
 });
 return paths;
}

// A standalone zero amount ("0 ₪", "₪0") — not the 0 inside "1,500".
const ZERO_AMOUNT=/(?<![\d,.])0[\s ‏‎]*₪|₪[\s ‏‎]*0(?![\d,.])/;

test('A loan with unknown values shows "חסר" — never 0 — and the totals say they are partial',async({page},info)=>{
 await page.setViewportSize({width:360,height:800});
 const paths=await mockApi(page);
 await page.goto('/accounts?tab=loans');

 const statementCard=page.locator('.loan-card').filter({hasText:'הלוואה 108'});
 await expect(statementCard).toBeVisible({timeout:15000});
 await expect(statementCard.getByText('חסר',{exact:true})).toBeVisible();
 await expect(statementCard.getByText('1,500')).toBeVisible();
 expect(await statementCard.innerText()).not.toMatch(ZERO_AMOUNT);

 const noRateCard=page.locator('.loan-card').filter({hasText:'הלוואה פרטית'});
 await expect(noRateCard.locator('.loan-fact').filter({hasText:'ריבית שנתית'})).toContainText('חסר');
 await expect(noRateCard.locator('.loan-fact').filter({hasText:'חודשית'}).filter({hasNotText:'החזר'})).toContainText('חסר');
 expect(await noRateCard.innerText()).not.toMatch(/null|NaN|Invalid Date/);
 // A typed opening date is not a payment date: the card names both, and the next one is an estimate.
 await expect(noRateCard.locator('.loan-fact').filter({hasText:'תשלום הבא (משוער)'})).toContainText('15.11.2026');
 await expect(noRateCard.locator('.loan-fact').filter({hasText:'תאריך פתיחה'})).toContainText('15.3.2020');
 const knownCard=page.locator('.loan-card').filter({hasText:'הלוואת רכב'});
 await expect(knownCard.locator('.loan-fact').filter({hasText:'תאריך פתיחה'})).toHaveCount(0);
 await expect(knownCard.locator('.loan-fact').filter({hasText:/^תשלום הבא/})).toContainText('15.11.2026');

 const balanceCard=page.locator('.summary-card').filter({hasText:'יתרת הקרן'});
 await expect(balanceCard).toContainText('לפחות');
 await expect(balanceCard).toContainText('38,000');
 await expect(balanceCard).toContainText('עוד הלוואה אחת ללא יתרה ידועה');
 await expect(balanceCard.locator('.tone-success')).toHaveCount(0);
 await expect(page.locator('.summary-card').filter({hasText:'ריבית חודשית'})).toContainText('חלקי — לא כולל 2 הלוואות ללא ריבית ידועה');

 const debtsChip=page.locator('.overview-chip').filter({hasText:'חובות'});
 await expect(debtsChip).toContainText('לפחות');
 await expect(debtsChip).toContainText('עוד הלוואה אחת ללא יתרה ידועה');

 await page.screenshot({path:info.outputPath('loans-unknown-360.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const violations=(await new AxeBuilder({page}).include('main').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));
 expect(violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);

 // Early repayment cannot be computed without a rate: the dialog says why and asks nothing of the server.
 await noRateCard.getByRole('button',{name:/פירעון מוקדם/}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByText(/אי אפשר לחשב פירעון מוקדם כי הריבית של ההלוואה חסרה/)).toBeVisible();
 expect(paths.some(p=>p.includes('early-repayment'))).toBe(false);
 const dialogViolations=(await new AxeBuilder({page}).include('[role=dialog]').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));
 expect(dialogViolations).toEqual([]);
});
