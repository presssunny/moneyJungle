import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The API is mocked end to end. A bank account opened without a balance, with nothing
// printed or stated to measure from, has an unknown balance: it reads "לא ידועה", never "0 ₪".
const unknownDetail={balance:null,basis:'unknown',anchor:null,afterAnchorNet:0,afterAnchorCount:0,explanation:'יתרה לא ידועה — אין יתרת פתיחה, דוח עם יתרה מודפסת או יתרה שהזנת'};
const account={id:1,bankName:'הבינלאומי',accountName:'עו״ש',initialBalance:null,currentBalance:null,balanceDetail:unknownDetail,_count:{transactions:93}};

async function mockApi(page:Page){
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/bank/accounts')reply={accounts:[account],totals:{totalBalance:null,unknownBalanceCount:1}};
  else if(path==='/api/journey/funding')reply={accounts:[{id:1,name:'עו״ש'}],spendingAccountId:null,savedReserve:0,savedReserveLocation:null,sources:[]};
  else if(path==='/api/savings')reply={goals:[],summary:{savedTotal:0}};
  else if(path==='/api/loans')reply={loans:[],summary:{activeCount:0},totals:{totalBalance:0,unknownBalanceCount:0}};
  await route.fulfill({json:reply});
 });
}

const ZERO_AMOUNT=/(?<![\d,.])0[\s ‏‎]*₪|₪[\s ‏‎]*0(?![\d,.])/;

test('An account with no stated balance reads "unknown" — never 0 — and offers the way to state it',async({page},info)=>{
 await page.setViewportSize({width:360,height:800});
 await mockApi(page);
 await page.goto('/accounts?tab=bank');

 const card=page.locator('.bank-account-card').filter({hasText:'עו״ש'});
 await expect(card).toContainText('יתרה לא ידועה',{timeout:15000});
 expect(await card.innerText()).not.toMatch(ZERO_AMOUNT);
 const kpi=page.locator('.summary-card').filter({hasText:'יתרה בחשבון הנבחר'});
 await expect(kpi).toContainText('לא ידועה');
 expect(await kpi.innerText()).not.toMatch(ZERO_AMOUNT);
 await expect(page.getByRole('heading',{name:'יתרה לא ידועה'})).toBeVisible();
 await expect(page.getByLabel('יתרה בבנק (₪)')).toBeVisible();
 // The accounts' total is the server's, and says why it is missing rather than showing 0.
 const chip=page.locator('.overview-chip').filter({hasText:'יתרות בנק רשומות'});
 await expect(chip).toContainText('לא זמין');
 await expect(chip).toContainText('חשבון אחד בלי יתרה ידועה');
 expect(await chip.innerText()).not.toMatch(ZERO_AMOUNT);

 await page.screenshot({path:info.outputPath('accounts-unknown-360.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const violations=(await new AxeBuilder({page}).include('main').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));
 expect(violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
});
