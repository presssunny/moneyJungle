import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The API is mocked end to end. A registered payment without an amount (a reminder with
// no estimate) must read "לא ידוע" — never "0 ₪" — and a month total that includes it is
// a lower bound ("לפחות").
const months=Array.from({length:12},(_,i)=>({monthKey:`2027-${String(i+1).padStart(2,'0')}`,incomeTotal:10000,expenseTotal:8000,balance:2000,scenarioBalance:2000}));
const commitments=months.map(({monthKey})=>monthKey==='2027-01'
 ?{monthKey,total:{knownTotal:1200,unknownCount:1},events:[{date:'2027-01-05T00:00:00.000Z',name:'חידוש רישיון',amount:null,kind:'reminder',basis:'estimate'},{date:'2027-01-10T00:00:00.000Z',name:'שכר דירה',amount:1200,kind:'recurring',basis:'last_debit'}]}
 :{monthKey,total:{knownTotal:0,unknownCount:0},events:[]});
const forecast={backtest:{monthsTested:0,meanAbsoluteExpenseError:null},generatedAt:'2026-12-15T10:00:00.000Z',anchorMonth:'2026-12',sufficient:true,
 baselineMonths:['2026-09','2026-10','2026-11'],history:[],months,annualBalance:24000,scenarioAnnualBalance:24000,commitments,
 heaviest:{monthKey:'2027-01',total:{knownTotal:1200,unknownCount:1}},partialMonths:[{monthKey:'2026-07',from:'2026-07-26',to:'2026-07-31'}]};

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

 await expect(page.getByRole('note').filter({hasText:'לא נכללו בממוצע חודשים שדוחות הבנק מכסים רק בחלקם'})).toBeVisible();
 await page.getByText(/תשלומים רשומים לחודש הזה/).click();
 const unknownRow=page.locator('.future-events li').filter({hasText:'חידוש רישיון'});
 await expect(unknownRow).toContainText('סכום לא ידוע');
 // An amount seen only as last month's debit says so.
 await expect(page.locator('.future-events li').filter({hasText:'שכר דירה'})).toContainText('לפי החיוב האחרון');
 expect(await page.locator('.future-detail').innerText()).not.toMatch(ZERO_AMOUNT);
 await expect(page.locator('.future-detail')).toContainText('לפחות');

 await page.screenshot({path:info.outputPath('forecast-unknown-360.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const violations=(await new AxeBuilder({page}).include('main').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));
 expect(violations.map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('The calendar shows the server\'s month: a reminder without an amount is unknown, and loans and card bills appear',async({page})=>{
 const now=new Date();const month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;const day=`${month}-15`;
 const asked:string[]=[];
 const event=(key:string,name:string,amount:number|null,kind:string,basis?:string)=>({key,date:day,name,amount,kind,basis,fingerprint:'f',decision:null,note:null,to:'/commitments'});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/journey/commitments/month'){asked.push(new URL(route.request().url()).searchParams.get('month')??'');
   reply={month,events:[event('r','חידוש רישיון',null,'reminder','estimate'),event('rec','שכר דירה',1200,'recurring','last_debit'),event('l','הלוואה 108',1226.29,'loan','last_debit'),event('c','כרטיס כאל',830,'credit')],
    total:{knownTotal:3256.29,unknownCount:1},heaviestDay:{date:`${day}T00:00:00.000Z`,count:4,total:{knownTotal:3256.29,unknownCount:1}},possibleCardOverlap:true};}
  await route.fulfill({json:reply});
 });
 await page.goto('/commitments?tab=calendar');
 const total=page.locator('.summary-card').filter({hasText:'צפוי לצאת החודש'});
 await expect(total).toContainText('לפחות',{timeout:15000});
 await expect(total).toContainText('עוד 1 בלי סכום');
 await expect(total).toContainText('ייתכן שתשלום קבוע בכרטיס כלול גם בחיוב הכרטיס');
 await expect(page.locator('.summary-card').filter({hasText:'היום העמוס'})).toContainText('לפחות');
 await expect(page.locator('.calendar-event').filter({hasText:'הלוואה 108'})).toContainText('לפי החיוב האחרון');
 await expect(page.locator('.calendar-event').filter({hasText:'כרטיס כאל'})).toBeVisible();
 await expect(page.locator('.calendar-event').filter({hasText:'חידוש רישיון'})).toContainText('סכום לא ידוע');
 expect(asked).toContain(month);
});
