import { test, expect } from '@playwright/test';

// A card's company is picked from the companies a bank line can name — never typed. Free text
// (or the card's own name) matches no bank debit, and the card's bill would count twice.
const summary={total:0,previousTotal:null,delta:null,nextCharge:null,categories:[],transactions:[],financingTotal:0};
test('A new card takes its company from a list, and the list says what "other" means',async({page})=>{
 const posted:unknown[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/bank/accounts')reply={accounts:[],totals:{totalBalance:0,unknownBalanceCount:0}};
  else if(path==='/api/savings')reply={goals:[],summary:{savedTotal:0}};
  else if(path==='/api/loans')reply={loans:[],summary:{activeCount:0},totals:{totalBalance:0,unknownBalanceCount:0}};
  else if(path==='/api/dashboard/charts')reply={trend:[],byCategory:[],creditByCategory:[],loanSplit:[]};
  else if(path==='/api/credit/wallet')reply={lastConfirmedImportAt:null,updatedAt:'2026-10-27T00:00:00Z',pendingCount:0,cards:[],all:summary,unassigned:summary};
  else if(path==='/api/credit/cards'&&req.method()==='POST'){posted.push(req.postDataJSON());reply={id:9,...req.postDataJSON()};}
  await route.fulfill({json:reply});
 });
 await page.goto('/accounts?tab=credit');
 await page.getByRole('button',{name:'+ הוספת כרטיס'}).click();
 await expect(page.getByRole('textbox',{name:/חברת/})).toHaveCount(0);
 const company=page.getByRole('combobox',{name:'חברת האשראי'});
 await expect(company.locator('option')).toContainText(['כאל','מקס','ישראכרט','אמריקן אקספרס','דיינרס']);
 await expect(company.locator('option',{hasText:'אחרת — החיוב בבנק לא יותאם לכרטיס'})).toHaveCount(1);
 await page.getByLabel('שם הכרטיס').fill('הכרטיס של אמא');
 await company.selectOption('מקס');
 await page.getByLabel('ארבע ספרות אחרונות').fill('4321');
 await page.getByRole('button',{name:'שמירת כרטיס'}).click();
 await expect.poll(()=>posted.length).toBe(1);
 expect(posted[0]).toMatchObject({name:'הכרטיס של אמא',issuer:'מקס',lastFour:'4321'});
});
