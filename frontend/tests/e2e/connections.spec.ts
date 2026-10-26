import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The API is mocked end to end: no backend, no browser worker, no bank.
const NO_CARD='חברת האשראי עוד לא נתמכת בכניסה בחלון נפרד. בינתיים אפשר להמשיך להעלות את קובץ העסקאות מהאתר שלה.';
const providers = [
 { id:'beinleumi',kind:'bank',name:'הבנק הבינלאומי',approvalHint:null,officialLoginUrl:'https://www.fibi.co.il/private/',unavailableReason:null,
  loginMethods:[{id:'official_window',label:'כניסה בחלון הרשמי של הבנק',description:'ייפתח חלון כרום נפרד עם האתר האמיתי של הבנק.',status:'experimental'}] },
 { id:'visaCal',kind:'card',name:'כאל',approvalHint:null,officialLoginUrl:null,unavailableReason:NO_CARD,loginMethods:[] },
 { id:'max',kind:'card',name:'מקס',approvalHint:null,officialLoginUrl:null,unavailableReason:NO_CARD,loginMethods:[] },
];
type Row = Record<string, unknown>;
type Script = Row[];
const axeSerious=async(page:Page)=>(await new AxeBuilder({page}).include('[role=dialog]').analyze()).violations.filter(v=>['serious','critical'].includes(v.impact??''));

/** Each GET of a running connection advances one step of `script`, as the server's phases would. */
async function mockConnections(page:Page, script:Script, options:{after?:Row;initial?:Row[];accounts?:Row[]}={}) {
 const connections:Row[]=[...(options.initial??[])];const accounts:Row[]=options.accounts??[{id:1,bankName:'הבינלאומי',accountName:'עו״ש',currentBalance:'0'}];const requests:Array<{method:string;path:string;body:unknown}>=[];let step=0;
 const base=(id:number,body:Row)=>({id,provider:body.provider,kind:'bank',label:'הבנק הבינלאומי',bankAccountId:body.bankAccountId??null,accountHint:null,loginMethod:'official_window',blockedReason:null,verifiedAt:null,lastSyncAt:null,createdAt:'2026-10-20T10:00:00Z',syncs:[],retryBlockedReason:null,retryMessage:null,retryAvailableAt:null});
 const withSync=(c:Row,sync:Row,extra:Row={})=>({...c,...extra,syncs:[{id:1,method:c.loginMethod,errorType:null,message:null,outcome:null,deadlineAt:null,startedAt:'2026-10-20T10:00:00Z',finishedAt:null,phase:null,...sync}]});
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
  const body=request.postData()?request.postDataJSON():null;requests.push({method,path,body});
  let reply:unknown=[];
  if(path==='/api/gate/session')reply={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')reply={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')reply={onboarding:'completed'};
  else if(path==='/api/bank/accounts'&&method==='POST'){accounts.push({id:41,currentBalance:null,...body});reply=accounts.at(-1);}
  else if(path==='/api/bank/accounts')reply={accounts,totals:{totalBalance:null,unknownBalanceCount:accounts.length}};
  else if(path==='/api/savings')reply={goals:[],summary:{savedTotal:0}};
  else if(path==='/api/loans')reply={loans:[],totals:{totalBalance:0}};
  else if(path==='/api/connections'&&method==='GET')reply={providers,connections};
  else if(path==='/api/connections'&&method==='POST'){connections.push(base(connections.length+1,body));reply=connections.at(-1);}
  else if(/\/api\/connections\/\d+$/.test(path)&&method==='PATCH'){const i=Number(path.split('/')[3])-1;connections[i]={...connections[i],...body,blockedReason:null,verifiedAt:null};reply=connections[i];}
  else if(/\/api\/connections\/\d+\/sync$/.test(path)){const i=Number(path.split('/')[3])-1;step=0;connections[i]=withSync(connections[i],{status:'running',phase:'queued'});reply=connections[i];}
  else if(/\/api\/connections\/\d+\/sync\/cancel$/.test(path)){const i=Number(path.split('/')[3])-1;connections[i]=withSync(connections[i],{status:'cancelled',phase:'awaiting_user',errorType:'CANCELLED',message:'הרענון בוטל. לא נוסף דבר.',finishedAt:'2026-10-20T10:01:00Z'});reply=connections[i];}
  else if(/\/api\/connections\/\d+$/.test(path)&&method==='GET'){
   const i=Number(path.split('/')[3])-1;const syncs=connections[i].syncs as Array<{status:string}>;
   if(syncs[0]?.status==='running'){const next=script[Math.min(step++,script.length-1)];connections[i]=withSync(connections[i],next,next.status==='running'?{}:options.after??{});}
   reply=connections[i];
  }
  await route.fulfill({json:reply});
 });
 return requests;
}

const soon=()=>new Date(Date.now()+5*60_000).toISOString();
const outcome=(reviewStatus:string)=>[{key:'bank:1',importSessionId:'s-1',target:'חשבון הבנק',rows:9,skippedPending:2,skippedForeign:1,skippedZero:0,storedThrough:null,pending:[],siteBalance:1234.5,ourBalance:reviewStatus==='completed'?1234.5:null,
 foreign:[{date:'2026-10-10',description:'AMAZON',originalAmount:-20,originalCurrency:'USD',chargedAmount:-20,chargedCurrency:'USD'}],review:{status:reviewStatus,counts:{included:5,duplicate:3,pending:reviewStatus==='completed'?0:1}}}];
const succeeded={status:'succeeded',phase:'building_import',message:'דוח אחד מחכה לאישור במסך הייבוא',finishedAt:'2026-10-20T10:02:00Z',outcome:outcome('ready_for_review')};
const repeat=(n:number,row:Row)=>Array.from({length:n},()=>row);

async function openNewConnection(page:Page){
 await page.goto('/accounts?tab=connections');
 await page.getByRole('button',{name:'חיבור בנק או כרטיס'}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('radio',{name:/הבנק הבינלאומי/}).check();
 await dialog.getByRole('button',{name:'המשך'}).click();
 await expect(dialog.locator('.sync-journey-host')).toHaveText('fibi.co.il');
 await dialog.getByLabel('התנועות ייכנסו לחשבון').selectOption('1');
 await dialog.getByRole('button',{name:'פתיחת חלון הבנק'}).click();
 return dialog;
}

test.describe.configure({timeout:90000});

test('She signs in at the bank\'s own window and sees each server-confirmed step: signed in, synced — and nothing claimed early',async({page},info)=>{
 const requests=await mockConnections(page,[{status:'running',phase:'launching'},...repeat(10,{status:'running',phase:'awaiting_user',deadlineAt:soon()}),...repeat(6,{status:'running',phase:'fetching'}),{status:'running',phase:'building_import'},succeeded]);
 const dialog=await openNewConnection(page);
 // Waiting for her: guidance with the bank's address, no success yet.
 await expect(dialog.getByText('ההתחברות נעשית בחלון של הבנק, לא כאן.')).toBeVisible({timeout:15000});
 await expect(dialog.locator('.sync-journey-guide .sync-journey-host')).toHaveText('fibi.co.il');
 await expect(dialog.getByText(/התחברת בהצלחה/)).toHaveCount(0);
 await expect(dialog.getByText(/זמן ההמתנה שנותר/)).toBeVisible();
 await expect(dialog.locator('img, iframe, canvas, input[type=password]')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('1-waiting-for-her.png')});
 expect(await axeSerious(page)).toEqual([]);
 // The server says she is in: the sign-in success appears, the sync is not yet "done".
 await expect(dialog.locator('.sync-journey-success').getByText('התחברת בהצלחה לבנק הבינלאומי')).toBeVisible({timeout:20000});
 await expect(dialog.getByText('הסנכרון הושלם')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('2-signed-in.png')});
 // Synced: a second, separate success — and the import is still waiting for her approval.
 await expect(dialog.locator('.sync-journey-turn').getByText('הסנכרון הושלם. עכשיו תורך: לבדוק ולאשר')).toBeVisible({timeout:25000});
 await expect(dialog.locator('.sync-journey-step-current')).toContainText('מחכה לאישור שלך במסך הייבוא');
 await expect(dialog.getByText('שום דבר לא נוסף עדיין. התנועות מחכות לאישור שלך במסך הייבוא.')).toBeVisible();
 await expect(dialog.getByText('הייבוא אושר')).toHaveCount(0);
 await expect(dialog.getByText('מחכה לאישור שלך במסך הייבוא')).toBeVisible();
 for(const line of ['ייכנסו באישור: 5','כבר רשומות: 3','מחכות להחלטה שלך: 1','בתהליך אצל הבנק, ייקלטו ברענון הבא: 2'])await expect(dialog.getByText(line,{exact:true})).toBeVisible();
 await expect(dialog.locator('.sync-journey-turn').getByRole('link',{name:'לבדיקה ואישור'})).toHaveAttribute('href','/imports?session=s-1');
 await expect(dialog.getByRole('heading',{name:'הנתונים מוכנים לבדיקה'})).toBeFocused();
 const polls=requests.filter(r=>r.method==='GET'&&/\/api\/connections\/\d+$/.test(r.path)).length;
 await page.waitForTimeout(3500);
 expect(requests.filter(r=>r.method==='GET'&&/\/api\/connections\/\d+$/.test(r.path)).length).toBe(polls);
 await page.screenshot({path:info.outputPath('3-synced.png')});
 expect(await axeSerious(page)).toEqual([]);
 const created=requests.find(r=>r.method==='POST'&&r.path==='/api/connections');
 expect(created?.body).toEqual({provider:'beinleumi',bankAccountId:1,accountHint:''});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('With no bank account yet (after a data wipe) she is told why and creates one without leaving the dialog',async({page},info)=>{
 const requests=await mockConnections(page,[{status:'running',phase:'launching'}],{accounts:[]});
 await page.goto('/accounts?tab=connections');
 await page.getByRole('button',{name:'חיבור בנק או כרטיס'}).click();
 const dialog=page.getByRole('dialog');
 await dialog.getByRole('radio',{name:/הבנק הבינלאומי/}).check();
 await dialog.getByRole('button',{name:'המשך'}).click();
 await expect(dialog.getByText('עוד אין במערכת חשבון בנק שהתנועות ייכנסו אליו.')).toBeVisible();
 await expect(dialog.getByLabel('התנועות ייכנסו לחשבון')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'פתיחת חלון הבנק'})).toBeDisabled();
 await page.screenshot({path:info.outputPath('no-account.png')});
 expect(await axeSerious(page)).toEqual([]);
 await dialog.getByLabel('שם החשבון (הבנק הבינלאומי)').fill('עו״ש משותף');
 await dialog.getByRole('button',{name:'יצירת החשבון'}).click();
 await expect(dialog.getByLabel('התנועות ייכנסו לחשבון')).toHaveValue('41');
 await expect(dialog.getByText('עוד אין במערכת חשבון בנק')).toHaveCount(0);
 expect(requests.find(r=>r.method==='POST'&&r.path==='/api/bank/accounts')?.body).toEqual({bankName:'הבנק הבינלאומי',accountName:'עו״ש משותף'});
 await dialog.getByRole('button',{name:'פתיחת חלון הבנק'}).click();
 await expect(dialog.getByRole('heading',{name:'מתחברים לבנק'})).toBeVisible();
 expect(requests.find(r=>r.method==='POST'&&r.path==='/api/connections')?.body).toEqual({provider:'beinleumi',bankAccountId:41,accountHint:''});
 expect(requests.some(r=>r.method==='POST'&&/\/sync$/.test(r.path))).toBe(true);
});

test('Only after she approves the import does the third success, "import approved", appear',async({page},info)=>{
 const approved={id:1,provider:'beinleumi',kind:'bank',label:'הבנק הבינלאומי',bankAccountId:1,accountHint:null,loginMethod:'official_window',blockedReason:null,verifiedAt:'2026-10-20T10:02:00Z',lastSyncAt:'2026-10-20T10:02:00Z',createdAt:'2026-10-20T10:00:00Z',retryBlockedReason:null,retryMessage:null,retryAvailableAt:null,
  syncs:[{id:1,status:'succeeded',phase:'building_import',method:'official_window',errorType:null,message:'דוח אחד מחכה לאישור במסך הייבוא',outcome:outcome('completed'),deadlineAt:null,startedAt:'2026-10-20T10:00:00Z',finishedAt:'2026-10-20T10:02:00Z'}]};
 await mockConnections(page,[],{initial:[approved]});
 await page.goto('/accounts?tab=connections');
 await page.getByRole('button',{name:/פרטי הרענון/}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.locator('.sync-journey-success').getByText('הייבוא אושר — התנועות נוספו')).toBeVisible();
 await expect(dialog.getByText('נוספו 5 תנועות.')).toBeVisible();
 await expect(dialog.getByText(/מחכה לאישור/)).toHaveCount(0);
 await expect(dialog.getByText('נוספו: 5',{exact:true})).toBeVisible();
 await expect(dialog.getByText(/היתרה אצלנו תואמת את אתר הבנק/)).toBeVisible();
 await page.screenshot({path:info.outputPath('4-approved.png')});
});

test('Card companies are shown honestly as not available in a separate window — no fake window',async({page})=>{
 await mockConnections(page,[]);
 await page.goto('/accounts?tab=connections');
 await page.getByRole('button',{name:'חיבור בנק או כרטיס'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.getByRole('radio',{name:/כאל/})).toBeDisabled();
 await expect(dialog.getByRole('radio',{name:/מקס/})).toBeDisabled();
 await expect(dialog.getByText(NO_CARD)).toBeVisible();
 await expect(dialog.getByRole('button',{name:'המשך'})).toBeDisabled();
});

test('If she closes the bank window, the journey stops at sign-in and she may try again at once',async({page})=>{
 await mockConnections(page,[...repeat(3,{status:'running',phase:'awaiting_user',deadlineAt:soon()}),{status:'failed',phase:'awaiting_user',errorType:'BROWSER_CLOSED',message:'חלון הבנק הבינלאומי נסגר לפני שהכניסה והקריאה הסתיימו. לא נוסף דבר.',finishedAt:'2026-10-20T10:01:00Z'}]);
 const dialog=await openNewConnection(page);
 await expect(dialog.getByRole('alert')).toContainText('נסגר לפני שהכניסה',{timeout:20000});
 await expect(dialog.locator('.sync-journey-step-failed')).toContainText('ממתינים שתיכנסי בחלון של הבנק');
 await expect(dialog.getByText(/התחברת בהצלחה/)).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'ניסיון נוסף'})).toBeVisible();
 expect(await axeSerious(page)).toEqual([]);
});

test('If Chrome never starts, she is told nothing reached the bank, no step claims the window opened, and she may retry at once',async({page})=>{
 const message='הדפדפן לא נפתח במחשב הזה, ולכן לא נוצר קשר עם הבנק הבינלאומי. זו תקלה אצלנו ולא בבנק — אפשר לנסות שוב מיד.';
 await mockConnections(page,[{status:'running',phase:'launching'},{status:'failed',phase:'launching',errorType:'BROWSER_LAUNCH',message,finishedAt:'2026-10-21T04:20:10Z'}]);
 const dialog=await openNewConnection(page);
 await expect(dialog.getByRole('alert')).toContainText(message,{timeout:20000});
 await expect(dialog.locator('.sync-journey-step-failed')).toContainText('פותחים את החלון של הבנק הבינלאומי');
 await expect(dialog.getByText('החלון של הבנק הבינלאומי נפתח')).toHaveCount(0);
 await expect(dialog.getByText(/התחברת בהצלחה/)).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'ניסיון נוסף'})).toBeEnabled();
 expect(await axeSerious(page)).toEqual([]);
});

test('Cancel during the wait stops the sync and says nothing was added',async({page})=>{
 const requests=await mockConnections(page,[{status:'running',phase:'awaiting_user',deadlineAt:soon()}]);
 const dialog=await openNewConnection(page);
 await dialog.getByRole('button',{name:'עצירת הרענון'}).click();
 await page.getByRole('button',{name:'עצירה'}).click();
 await expect(page.getByText('הרענון בוטל. לא נוסף דבר.').first()).toBeVisible();
 expect(requests.some(r=>r.method==='POST'&&r.path.endsWith('/sync/cancel'))).toBe(true);
});

test('A first refresh the server refuses (too many attempts) is explained in the dialog',async({page})=>{
 await mockConnections(page,[{status:'running',phase:'launching'}]);
 await page.route(/\/api\/connections\/\d+\/sync$/,route=>route.fulfill({status:429,json:{error:{message:'יותר מדי ניסיונות כניסה לבנק ברבע השעה האחרונה.'}}}));
 const dialog=await openNewConnection(page);
 await expect(dialog.getByRole('alert')).toContainText('יותר מדי ניסיונות');
});

test('A connection saved with credentials before the change can move to the bank\'s own window',async({page})=>{
 const legacy={id:1,provider:'beinleumi',kind:'bank',label:'הבנק הבינלאומי',bankAccountId:1,accountHint:null,loginMethod:'password',blockedReason:null,verifiedAt:null,lastSyncAt:null,createdAt:'2026-10-01T10:00:00Z',syncs:[],retryBlockedReason:null,retryMessage:null,retryAvailableAt:null};
 const requests=await mockConnections(page,[],{initial:[legacy]});
 await page.goto('/accounts?tab=connections');
 await expect(page.getByText(/כניסה עם פרטים שנשמרו בעבר/)).toBeVisible();
 await page.getByRole('button',{name:/מעבר לכניסה בחלון הבנק/}).click();
 await expect(page.getByRole('button',{name:/רענון נתונים: הבנק הבינלאומי/})).toHaveText('פתיחת חלון הבנק');
 expect(requests.find(r=>r.method==='PATCH')?.body).toEqual({loginMethod:'official_window'});
});
