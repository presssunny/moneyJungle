import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ImportSession } from '../../src/types/journey.types';
import type { LoanDetailsPreviewItem, StandingOrderPreviewItem } from '../../src/types/models';

// CLAUDE.md §7 A2: what the bank's own pages showed enters as an import to approve. The API is mocked end to end.
type Row = Record<string, unknown>;
const axeSerious=async(page:Page,scope='main')=>(await new AxeBuilder({page}).include(scope).analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??'')).map(v=>`${v.id}: ${v.nodes.map(n=>n.target.join(' ')).join(', ')}`);

const loanBase:LoanDetailsPreviewItem={key:'loan:108:432',loanNumberLast4:'0108',trackNumber:'432',name:'משכנתא',principalBalance:120000,annualInterestRate:4.5,nextPaymentAmount:1500,nextPaymentDate:'2026-12-10',
 paymentsMade:40,paymentsTotal:240,endDate:'2045-01-10',interestType:'prime',indexLinked:false,indexedBalance:null,asOf:'2026-11-15',missing:[],
 match:{loanId:7,loanName:'משכנתא בינלאומי',checkingLines:3,reason:'matched'},fills:[{field:'currentBalance',value:120000},{field:'endDate',value:'2045-01-10'}],notes:['ריבית שנתית: הבנק מציג 4.6']};
const loans:LoanDetailsPreviewItem[]=[
 loanBase,
 {...loanBase,key:'loan:109:-',loanNumberLast4:'0109',trackNumber:null,name:null,principalBalance:null,annualInterestRate:null,interestType:null,missing:['principalBalance','annualInterestRate','interestType'],
  match:{loanId:null,loanName:null,checkingLines:0,reason:'no_loan'},fills:[],notes:[]},
 {...loanBase,key:'loan:110:1',loanNumberLast4:'0110',trackNumber:'1',interestType:'fixed',indexLinked:true,indexedBalance:130000,match:{loanId:null,loanName:null,checkingLines:2,reason:'ambiguous'},fills:[],notes:[]},
];
const orderBase:StandingOrderPreviewItem={key:'order:ועד בית:1234:5',payee:'ועד בית',amount:350,dayOfMonth:5,kind:'standing_order',status:'active',
 match:{detectedKey:'recurring:ועד:350',name:'ועד בית',lastDebitDate:'2026-11-05',reason:'matched',recurringPaymentId:12,canAdd:false}};
const orders:StandingOrderPreviewItem[]=[
 orderBase,
 {...orderBase,key:'order:חברת חשמל:-:12',payee:'חברת חשמל',amount:null,dayOfMonth:12,kind:'direct_debit',match:{detectedKey:'recurring:חשמל',name:'חברת החשמל',lastDebitDate:'2026-11-12',reason:'matched',recurringPaymentId:null,canAdd:true}},
 {...orderBase,key:'order:ביטוח:-:20',payee:'ביטוח רכב',amount:410,dayOfMonth:20,match:{detectedKey:null,name:null,lastDebitDate:null,reason:'no_checking_debit',recurringPaymentId:null,canAdd:false}},
 {...orderBase,key:'order:גן:-:1',payee:'גן ילדים',amount:900,dayOfMonth:1,status:'inactive',match:{detectedKey:null,name:null,lastDebitDate:null,reason:'ambiguous',recurringPaymentId:null,canAdd:false}},
];
const snapshotSession=(kind:'loan_details'|'standing_orders'):ImportSession=>({id:`site-${kind}`,fileName:'סנכרון הבינלאומי מהאתר.json',kind,status:'ready_for_review',version:2,answers:{kind,accountId:1},
 preview:{rows:[],count:0,total:0,questions:[],warnings:['הנתונים מאתר הבנק לא מוסיפים הוצאות.'],siteSnapshot:kind==='loan_details'?{kind,loans}:{kind,orders}},result:null});

async function mockApi(page:Page,initial?:ImportSession,extra:Record<string,unknown>={}){
 let session=initial;const requests:Array<{action:string;payload:unknown}>=[];
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  let body:unknown=[];
  if(path==='/api/gate/session')body={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')body={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')body={onboarding:'completed'};
  else if(path==='/api/journey/home'||path==='/api/journey/status')body={profile:{onboarding:'completed'},balances:[{id:1,name:'עו״ש משפחתי',balance:0,explanation:'',anchor:null}],cards:[],sources:[],issues:[],blockers:[],actions:[],actionCount:0,coverageAcknowledged:false,events:[]};
  else if(path in extra)body=extra[path];
  else if(session&&path.endsWith('/commit')){
   requests.push({action:'commit',payload:request.postDataJSON()});
   session={...session,version:session.version+1,status:'review',result:{details:session.kind==='loan_details'?{kind:session.kind,updated:1}:{kind:session.kind,labelled:1,added:1}}};body=session;
  }else if(session&&path.endsWith('/complete')){
   requests.push({action:'complete',payload:request.postDataJSON()});session={...session,version:session.version+1,status:'completed'};body=session;
  }else if(session&&path.includes('/imports/sessions/'))body=session;
  else if(path==='/api/loans')body={loans:[]};
  await route.fulfill({json:body});
 });
 return requests;
}

test('Loan tracks from the bank site: matched, no loan and ambiguous each say what approval does; a missing figure is never 0',async({page},info)=>{
 const requests=await mockApi(page,snapshotSession('loan_details'));
 await page.goto('/imports?session=site-loan_details');
 const list=page.getByRole('list',{name:'מסלולי הלוואה מאתר הבנק'});
 await expect(page.getByRole('heading',{name:'נקראו 3 מסלולי הלוואה מאתר הבנק'})).toBeVisible();
 const items=list.getByRole('listitem').filter({has:page.locator('.site-snapshot-title')});
 await expect(items).toHaveCount(3);
 const matched=items.nth(0);
 await expect(matched.getByRole('heading')).toHaveText('הלוואה …0108 · מסלול 432 · משכנתא');
 await expect(matched.getByText('לפי אתר הבנק, נכון ל־15.11.2026')).toBeVisible();
 await expect(matched.getByText('תואם להלוואה משכנתא בינלאומי · 3 חיובים בעו״ש')).toBeVisible();
 await expect(matched.locator('.site-snapshot-fills li')).toHaveText([/^יתרת קרן: .*120,000\.00/,'תאריך סיום: 10.01.2045']);
 await expect(matched.getByText('ריבית שנתית: הבנק מציג 4.6')).toBeVisible();
 // Prime: the next payment moves with the rate.
 await expect(matched.locator('dd').filter({hasText:'1,500'}).getByText('אומדן')).toBeVisible();

 const noLoan=items.nth(1);
 await expect(noLoan.getByText('לא נמצאה הלוואה מתאימה במערכת — אפשר להעלות לוח סילוקין או לאשר את ההלוואה שזוהתה מהעו״ש')).toBeVisible();
 await expect(noLoan.getByText('לא יישמר דבר — הנתונים מוצגים להשוואה')).toBeVisible();
 await expect(noLoan.locator('div').filter({hasText:/^יתרת קרן/}).locator('dd')).toHaveText('לא הופיע בדף');
 await expect(noLoan.locator('div').filter({hasText:/^ריבית שנתית/}).locator('dd')).toHaveText('לא הופיע בדף');
 expect(await noLoan.innerText()).not.toMatch(/(?<![\d,.])0[\s ‏‎]*₪|₪[\s ‏‎]*0(?![\d,.])|null|NaN/);

 const ambiguous=items.nth(2);
 await expect(ambiguous.getByText('לא ברור לאיזו הלוואה זה שייך — לא נקשר אוטומטית')).toBeVisible();
 await expect(ambiguous.locator('div').filter({hasText:/^יתרה משוערכת/}).locator('dd')).toContainText('130,000');
 await expect(ambiguous.locator('dd').filter({hasText:'1,500'}).getByText('אומדן')).toBeVisible();

 await expect(page.getByRole('checkbox')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('site-loans.png'),fullPage:true});
 expect(await axeSerious(page)).toEqual([]);

 await page.getByRole('button',{name:'אישור ושמירה'}).click();
 await expect(page.getByText('עודכנו פרטים ב־1 הלוואות.')).toBeVisible();
 expect(requests).toEqual([{action:'commit',payload:{version:2,acceptCommitments:[]}},{action:'complete',payload:{version:3}}]);
 await expect(page.getByRole('link',{name:'למסך ההלוואות'})).toHaveAttribute('href','/accounts?tab=loans');
});

test('Standing orders from the bank site: matched, no debit and ambiguous; only a ticked "add" is sent',async({page},info)=>{
 const requests=await mockApi(page,snapshotSession('standing_orders'));
 await page.goto('/imports?session=site-standing_orders');
 await expect(page.getByRole('heading',{name:'נקראו 4 הוראות קבע והרשאות מאתר הבנק'})).toBeVisible();
 const items=page.getByRole('list',{name:'הוראות קבע והרשאות מאתר הבנק'}).getByRole('listitem');
 await expect(items).toHaveCount(4);
 await expect(items.nth(0)).toContainText('הוראת קבע · פעילה');
 await expect(items.nth(0).getByText("תואם לחיוב חוזר ועד בית · חיוב אחרון 05.11.2026 — יסומן 'אומת באתר הבנק'")).toBeVisible();
 await expect(items.nth(1)).toContainText('סכום משתנה · ב־12 לחודש · הרשאה לחיוב · פעילה');
 await expect(items.nth(2).getByText('הוראה פעילה בבנק שעוד לא ראינו חיוב שלה — לא תישמר')).toBeVisible();
 await expect(items.nth(3)).toContainText('לא פעילה');
 await expect(items.nth(3).getByText('לא ברור לאיזה חיוב זה שייך — לא נקשר אוטומטית')).toBeVisible();
 const add=page.getByRole('checkbox',{name:/להוסיף כתשלום קבוע/});
 await expect(add).toHaveCount(1);
 await expect(add).not.toBeChecked();
 await page.screenshot({path:info.outputPath('site-orders.png'),fullPage:true});
 expect(await axeSerious(page)).toEqual([]);
 await add.check();
 await page.getByRole('button',{name:'אישור ושמירה'}).click();
 await expect(page.getByText("1 תשלומים קבועים סומנו 'אומת באתר הבנק' · נוספו 1 תשלומים קבועים.")).toBeVisible();
 expect(requests[0]).toEqual({action:'commit',payload:{version:2,acceptCommitments:['order:חברת חשמל:-:12']}});
 await expect(page.getByRole('link',{name:'לתשלומים הקבועים'})).toHaveAttribute('href','/commitments?tab=recurring');
});

test('A recurring payment the bank site verified carries a small badge, and one inactive at the bank says so',async({page})=>{
 const item=(id:number,name:string,extra:Row={})=>({id,name,amount:'350.00',categoryId:null,paymentMethodId:null,frequency:'monthly',nextPaymentDate:'2026-12-05T00:00:00.000Z',category:null,paymentMethod:null,
  verifiedAt:null,verifiedSource:null,debitKind:null,bankStatus:null,bankReference:null,...extra});
 await mockApi(page,undefined,{'/api/recurring':{items:[
  item(1,'ועד בית',{verifiedAt:'2026-11-15T00:00:00.000Z',verifiedSource:'bank_site',debitKind:'standing_order',bankStatus:'active'}),
  item(2,'חוג',{verifiedAt:'2026-11-15T00:00:00.000Z',verifiedSource:'bank_site',bankStatus:'inactive'}),
  item(3,'נטפליקס'),
 ],monthlyTotal:1050}});
 await page.goto('/commitments?tab=recurring');
 const row=(name:string)=>page.getByRole('row').filter({hasText:name});
 await expect(row('ועד בית').getByText('אומת באתר הבנק')).toBeVisible({timeout:15000});
 await expect(row('ועד בית').getByText('לא פעילה בבנק')).toHaveCount(0);
 await expect(row('חוג').getByText('לא פעילה בבנק')).toBeVisible();
 await expect(row('נטפליקס').locator('.source-tag')).toHaveCount(0);
 expect(await axeSerious(page)).toEqual([]);
});

test('A loan whose figures came from the bank site says so, with the date',async({page})=>{
 const loan={id:7,loanName:'משכנתא בינלאומי',loanType:'mortgage',lenderName:null,originalAmount:null,currentBalance:120000,annualInterestRate:4.5,monthlyPayment:1500,startDate:'2026-11-10',startDateMeaning:'recorded',
  nextPaymentDate:'2026-12-10',endDate:'2045-01-10',isIndexLinked:false,earlyRepaymentFee:null,status:'active',loanNumber:'108',trackNumber:'432',trackName:null,closedAt:null,closureReason:null,closureCost:null,
  totalPayments:240,paymentsMade:40,scheduleSource:'statement',originalAmountSource:'unknown',scheduleImportedAt:null,siteSnapshotAsOf:'2026-11-15T00:00:00.000Z',computed:null,
  progress:{lifecycle:'active',principalRepaid:0,progressPercent:0,paymentsMade:40,paymentsRemaining:200,totalPayments:240,certainty:'scenario'}};
 const summary={activeCount:1,closedCount:0,totalBalance:120000,monthlyPayment:1500,monthlyInterest:0,annualInterest:0,freedMonthlyPayment:0,closureCosts:0,endingSoonCount:0,hasScenarioProgress:true,unknownBalanceCount:0,unknownInterestCount:1};
 await mockApi(page,undefined,{'/api/loans':{loans:[loan],summary,groups:[],events:[],fromStatement:null,totals:{totalBalance:120000,monthlyPayment:1500,monthlyInterest:0,annualInterest:0,activeCount:1,unknownBalanceCount:0,unknownInterestCount:1}},
  '/api/bank/accounts':{accounts:[],totals:{totalBalance:null,unknownBalanceCount:0}},'/api/savings':{goals:[],summary:{savedTotal:0}}});
 await page.goto('/accounts?tab=loans');
 const card=page.locator('.loan-card').filter({hasText:'משכנתא בינלאומי'});
 await expect(card.getByText('לפי אתר הבנק, נכון ל־15.11.2026')).toBeVisible({timeout:15000});
 expect(await axeSerious(page)).toEqual([]);
});
