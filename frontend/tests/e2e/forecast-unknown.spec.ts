import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The API is mocked end to end. A registered payment without an amount (a reminder with
// no estimate) must read "לא ידוע" — never "0 ₪" — and a month total that includes it is
// a lower bound ("לפחות").
const months=Array.from({length:12},(_,i)=>({monthKey:`2027-${String(i+1).padStart(2,'0')}`,incomeTotal:10000,expenseTotal:8000,balance:2000,scenarioBalance:2000}));
const commitments=months.map(({monthKey})=>monthKey==='2027-01'
 ?{monthKey,total:{knownTotal:1200,unknownCount:1},events:[{date:'2027-01-05T00:00:00.000Z',name:'חידוש רישיון',amount:null,kind:'reminder'},{date:'2027-01-10T00:00:00.000Z',name:'שכר דירה',amount:1200,kind:'recurring'}]}
 :{monthKey,total:{knownTotal:0,unknownCount:0},events:[]});
const forecast={backtest:{monthsTested:0,meanAbsoluteExpenseError:null},generatedAt:'2026-12-15T10:00:00.000Z',anchorMonth:'2026-12',sufficient:true,
 baselineMonths:['2026-09','2026-10','2026-11'],history:[],months,annualBalance:24000,scenarioAnnualBalance:24000,commitments,
 heaviest:{monthKey:'2027-01',total:{knownTotal:1200,unknownCount:1}}};

async function mockApi(page:Page){
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/reports/forecast')reply=forecast;
  await route.fulfill({json:reply});
 });
}

const ZERO_AMOUNT=/(?<![\d,.])0[\s ‏‎]*₪|₪[\s ‏‎]*0(?![\d,.])/;

test('A registered payment without an amount is unknown, and the month total is "at least"',async({page},info)=>{
 await page.setViewportSize({width:360,height:800});
 await mockApi(page);
 await page.goto('/reports?tab=forecast');

 const heaviest=page.locator('.summary-card').filter({hasText:'החודש העמוס'});
 await expect(heaviest).toContainText('לפחות',{timeout:15000});
 await expect(heaviest).toContainText('1,200');
 await expect(heaviest).toContainText('עוד 1 בלי סכום');

 await page.getByText(/תשלומים רשומים לחודש הזה/).click();
 const unknownRow=page.locator('.future-events li').filter({hasText:'חידוש רישיון'});
 await expect(unknownRow).toContainText('סכום לא ידוע');
 expect(await page.locator('.future-detail').innerText()).not.toMatch(ZERO_AMOUNT);
 await expect(page.locator('.future-detail')).toContainText('לפחות');

 await page.screenshot({path:info.outputPath('forecast-unknown-360.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const violations=(await new AxeBuilder({page}).include('main').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));
 expect(violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
});
