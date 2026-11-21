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
const outcome=(reviewStatus:string)=>[{key:'bank:1',importSessionId:'s-1',target:'חשבון הבנק',rows:9,skippedPending:2,skippedForeign:1,skippedZero:0,storedThrough:null,pending:[],siteBalance:1234.5,balanceCheck:reviewStatus==='completed'?{status:'match',ourBalance:1234.5,gap:0,asOf:'2026-10-01'}:null,
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
 await expect(dialog.getByText(/היתרה אצלנו נכון ל־.* תואמת את אתר הבנק/)).toBeVisible();
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

// Bank sync → loans (design 2026-11-13, scenario 12): the stage list is the server's; only "done" may look like success.
// `status` and `incomplete` are the server's (syncStageStatus.ts); the page only shows them, so the mock states them.
const stage=(stage:string,state:string,status:string,code:string|null=null,count?:number)=>({stage,state,status,code,...(count===undefined?{}:{count})});
const BLOCKED='פרטי ההלוואות לא נקראו מהאתר — קריאת הדף כבויה בהגדרות. אפשר להעלות לוח סילוקין כקובץ במסך ההלוואות';
const loanStages=(details:Row,imported:Row,department:Row=stage('loans_department','skipped','unavailable','DISABLED'))=>[stage('checking','done','done',null,9),stage('loan_detection','done','done',null,1),department,details,imported];
const VISITED=stage('loans_department','done','done');
const loanItem=(status:string,included:number)=>({kind:'loan_schedule',key:'loan:90001:301',importSessionId:'s-2',target:'הלוואה 90001 · מסלול 301',rows:3,skippedPending:0,skippedForeign:0,skippedZero:0,storedThrough:null,pending:[],foreign:[],
 review:{status,counts:{included,duplicate:0,pending:0}}});
const finishedSync=(outcome:Row[],message:string,incomplete?:boolean)=>({id:1,provider:'beinleumi',kind:'bank',label:'הבנק הבינלאומי',bankAccountId:1,accountHint:null,loginMethod:'official_window',blockedReason:null,verifiedAt:'2026-10-20T10:02:00Z',lastSyncAt:'2026-10-20T10:02:00Z',createdAt:'2026-10-20T10:00:00Z',retryBlockedReason:null,retryMessage:null,retryAvailableAt:null,
 syncs:[{id:1,status:'succeeded',phase:'building_import',method:'official_window',errorType:null,message,outcome,deadlineAt:null,startedAt:'2026-10-20T10:00:00Z',finishedAt:'2026-10-20T10:02:00Z',...(incomplete===undefined?{}:{incomplete})}]});
async function openSummary(page:Page,connection:Row){
 await mockConnections(page,[],{initial:[connection]});
 await page.goto('/accounts?tab=connections');
 await page.getByRole('button',{name:/פרטי הרענון/}).click();
 return page.getByRole('dialog');
}

test('A loan details step the bank sync may not run yet is shown as blocked, in its own words, never as success',async({page},info)=>{
 const [account]=outcome('ready_for_review');
 const dialog=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','blocked','blocked','NOT_APPROVED'),stage('loan_schedule_import','skipped','not_needed',null,0))}],'דוח אחד מחכה לאישור במסך הייבוא · פרטי ההלוואות לא הושלמו — ראו פירוט',true));
 const stages=dialog.getByRole('region',{name:'שלבי הסנכרון'});
 // A flag that is off is not "not needed": a loan line was found and the step was wanted.
 await expect(stages.getByRole('listitem')).toHaveText(['✓התנועות בעו״ש נקראומצב: הושלם','✓זוהו 1 חיובי הלוואהמצב: הושלם','–המעבר לדף ההלוואות כבוי בהגדרות, לכן לא בוצעמצב: לא זמין',`⊘${BLOCKED}מצב: חסום במדיניות`,'–אין לוח סילוקין לשמורמצב: לא נדרש']);
 await expect(stages.getByText('לא נדרש מעבר לדף ההלוואות')).toHaveCount(0);
 const blocked=stages.getByRole('listitem').filter({hasText:BLOCKED});
 await expect(blocked).toHaveClass(/connection-state-waiting/);
 await expect(blocked).not.toHaveClass(/sync-stage-done/);
 await expect(stages.getByRole('listitem').filter({hasText:'התנועות בעו״ש נקראו'})).toHaveClass(/sync-stage-done/);
 await expect(dialog.locator('.sync-journey-success, .sync-journey-success-final').getByText(BLOCKED)).toHaveCount(0);
 await expect(dialog.locator('.sync-journey-steps').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו')).toBeVisible();
 await expect(dialog.getByText('הסנכרון הושלם',{exact:false})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('loans-blocked.png')});
 expect(await axeSerious(page)).toEqual([]);
});

// The stages of the real sync that showed the bug (2026-11-14): only the checking part completed.
const STANDING_BLOCKED='הוראות הקבע וההרשאות לחיוב לא נקראו מאתר הבנק — קריאת הדף כבויה בהגדרות';
const DOCUMENTS_BLOCKED='מסמכים ודוחות לא הורדו מאתר הבנק — הורדה כזו עדיין לא אושרה. אפשר להעלות קובץ במסך הייבוא';
const fullStages=(detection:Row,department:Row=stage('loans_department','skipped','unavailable','DISABLED'))=>[stage('checking','done','done',null,79),stage('loan_detection','partial','awaiting_approval','AMBIGUOUS',1),department,stage('loan_details','blocked','blocked','NOT_APPROVED'),stage('loan_schedule_import','skipped','not_needed',null,0),
 detection,stage('standing_orders_verification','blocked','blocked','NOT_APPROVED'),stage('bank_documents','blocked','blocked','NOT_APPROVED')];
test('Every stage of a partial bank sync is grouped, says what was not collected, and carries its own status — never "sync complete"',async({page},info)=>{
 const [account]=outcome('ready_for_review');
 const dialog=await openSummary(page,finishedSync([{...account,stages:fullStages(stage('standing_orders_detection','done','done','INFERRED',4))}],'דוח אחד מחכה לאישור במסך הייבוא · לא נאספו: פרטי הלוואות, אימות הוראות קבע, מסמכי בנק — ראו פירוט',true));
 const stages=dialog.getByRole('region',{name:'שלבי הסנכרון'});
 await expect(stages.getByRole('heading')).toHaveText(['עו״ש','הלוואות','הוראות קבע','מסמכים']);
 const group=(name:string)=>stages.getByRole('list',{name}).locator('.sync-stage-status');
 await expect(group('עו״ש')).toHaveText(['מצב: הושלם']);
 await expect(group('הלוואות')).toHaveText(['מצב: ממתין לאישור','מצב: לא זמין','מצב: חסום במדיניות','מצב: לא נדרש']);
 await expect(group('הוראות קבע')).toHaveText(['מצב: הושלם','מצב: חסום במדיניות']);
 await expect(group('מסמכים')).toHaveText(['מצב: חסום במדיניות']);
 await expect(stages.getByText('1 חיובי הלוואה לא שויכו להלוואה אחת — תתבקשי לבחור במסך הייבוא')).toBeVisible();
 await expect(stages.getByText('זוהו 4 חיובים חוזרים מתוך העו״ש (הסקה מהתנועות — לא אומת מול הוראות הקבע בבנק)')).toBeVisible();
 await expect(stages.getByText(STANDING_BLOCKED)).toBeVisible();
 await expect(stages.getByText(DOCUMENTS_BLOCKED)).toBeVisible();
 await expect(dialog.locator('.sync-journey-steps').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו')).toBeVisible();
 await expect(dialog.locator('.sync-journey-turn').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו. עכשיו תורך: לבדוק ולאשר')).toBeVisible();
 await expect(dialog.getByText('הסנכרון הושלם',{exact:false})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('sync-partial.png')});
 expect(await axeSerious(page)).toEqual([]);
 await page.unrouteAll({behavior:'ignoreErrors'});
 const short=await openSummary(page,finishedSync([{...account,stages:fullStages(stage('standing_orders_detection','skipped','unavailable','WINDOW_TOO_SHORT'),stage('loans_department','skipped','unavailable','NOT_OFFICIAL_WINDOW'))}],'דוח אחד מחכה לאישור במסך הייבוא',true));
 const shortStages=short.getByRole('region',{name:'שלבי הסנכרון'});
 await expect(shortStages.getByRole('listitem').filter({hasText:'אין מספיק חודשים בעו״ש כדי לזהות חיובים חוזרים'}).locator('.sync-stage-status')).toHaveText('מצב: לא זמין');
 await expect(shortStages.getByRole('listitem').filter({hasText:'המעבר לדף ההלוואות אפשרי רק בכניסה בחלון של הבנק'}).locator('.sync-stage-status')).toHaveText('מצב: לא זמין');
 await page.unrouteAll({behavior:'ignoreErrors'});
 const none=await openSummary(page,finishedSync([{...account,stages:fullStages(stage('standing_orders_detection','skipped','not_needed','NO_RECURRING'))}],'דוח אחד מחכה לאישור במסך הייבוא',true));
 await expect(none.getByRole('region',{name:'שלבי הסנכרון'}).getByRole('listitem').filter({hasText:'לא זוהו חיובים חוזרים'}).locator('.sync-stage-status')).toHaveText('מצב: לא נדרש');
});

test('A loan schedule waits for its own approval and is not counted as account transactions',async({page})=>{
 const [account]=outcome('ready_for_review');
 const dialog=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','done','done',null,1),stage('loan_schedule_import','done','awaiting_approval',null,1),VISITED)},loanItem('ready_for_review',3)],'דוח אחד מחכה לאישור במסך הייבוא',false));
 const schedules=dialog.getByRole('region',{name:'לוחות סילוקין לאישור'});
 await expect(schedules.getByText('הלוואה 90001 · מסלול 301')).toBeVisible();
 await expect(schedules.getByRole('link',{name:'לבדיקה ואישור: הלוואה 90001 · מסלול 301'})).toHaveAttribute('href','/imports?session=s-2');
 await expect(dialog.getByRole('region',{name:'שלבי הסנכרון'}).getByText('1 לוחות סילוקין מחכים לאישור')).toBeVisible();
 // The account's own counts only: the schedule's three payments are not "to be added" transactions.
 await expect(dialog.getByText('ייכנסו באישור: 5',{exact:true})).toBeVisible();
 await expect(dialog.getByText(/ייכנסו באישור: 8/)).toHaveCount(0);
});

test('Once both are approved, "added" counts the account\'s transactions only, and an incomplete loan stage keeps it from "all done"',async({page})=>{
 const [account]=outcome('completed');
 const done=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','done','done',null,1),stage('loan_schedule_import','done','awaiting_approval',null,1),VISITED)},loanItem('completed',3)],'דוח אחד מחכה לאישור במסך הייבוא',false));
 await expect(done.getByText('נוספו 5 תנועות.')).toBeVisible();
 await expect(done.getByText('נוספו 8 תנועות.')).toHaveCount(0);
 await expect(done.getByText('הכול נקלט')).toBeVisible();
 await page.unrouteAll({behavior:'ignoreErrors'});
 const blocked=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','blocked','blocked','NOT_APPROVED'),stage('loan_schedule_import','skipped','not_needed',null,0))}],'דוח אחד מחכה לאישור במסך הייבוא · פרטי ההלוואות לא הושלמו — ראו פירוט',true));
 await expect(blocked.getByText('התנועות נקלטו — חלק מהנתונים לא נאספו')).toBeVisible();
 await expect(blocked.getByText('הכול נקלט')).toHaveCount(0);
 await expect(blocked.getByText('חלק מהנתונים לא נאספו — הפירוט בסיכום הרענון.')).toHaveClass(/connection-state-waiting/);
});

// Each stop speaks for itself: our own fault is never told as the bank's.
test('Each loans-page stop, a rejected schedule and a failed standing-orders check say what happened, with the server\'s status',async({page})=>{
 const [account]=outcome('ready_for_review');
 const cases:Array<[Row,string,string]>=[
  [stage('loans_department','failed','failed','SESSION_LOST'),'לא הגענו לדף ההלוואות: הבנק ניתק את הכניסה — לא ניסינו שוב','מצב: נכשל'],
  [stage('loans_department','failed','unavailable','NOT_IN_MENU'),'לא הגענו לדף ההלוואות: הדף לא מופיע בתפריט — לא ניסינו שוב','מצב: לא זמין'],
  [stage('loans_department','failed','failed','ERROR'),'המעבר לדף ההלוואות לא הושלם בגלל תקלה אצלנו — לא ניסינו שוב','מצב: נכשל'],
  [stage('loans_department','failed','failed','REDIRECT'),'לא הגענו לדף ההלוואות: הבנק הפנה לדף אחר — לא ניסינו שוב','מצב: נכשל'],
  [stage('loans_department','failed','failed','HTTP_STATUS'),'לא הגענו לדף ההלוואות: הבנק החזיר שגיאה — לא ניסינו שוב','מצב: נכשל'],
  [stage('loans_department','failed','failed','NEW_TAB'),'לא הגענו לדף ההלוואות: נפתחה לשונית חדשה — עצרנו — לא ניסינו שוב','מצב: נכשל'],
 ];
 for(const [department,text,status] of cases){
  const dialog=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','skipped','unavailable','NOT_RUN'),stage('loan_schedule_import','skipped','not_needed',null,0),department)}],'דוח אחד מחכה לאישור במסך הייבוא',true));
  const line=dialog.getByRole('region',{name:'שלבי הסנכרון'}).getByRole('listitem').filter({hasText:text});
  await expect(line).toHaveCount(1);
  await expect(line.locator('.sync-stage-status')).toHaveText(status);
  await expect(dialog.getByText('הבנק לא הציג את הדף',{exact:false})).toHaveCount(0);
  await page.unrouteAll({behavior:'ignoreErrors'});
 }
 const rejected=await openSummary(page,finishedSync([{...account,stages:loanStages(stage('loan_details','done','done',null,1),stage('loan_schedule_import','failed','failed','SCHEDULE_REJECTED'),VISITED)}],'דוח אחד מחכה לאישור במסך הייבוא',true));
 await expect(rejected.getByRole('listitem').filter({hasText:'לוחות הסילוקין לא נשמרו: הלוח לא עבר את בדיקת התקינות'}).locator('.sync-stage-status')).toHaveText('מצב: נכשל');
 await page.unrouteAll({behavior:'ignoreErrors'});
 const standing=await openSummary(page,finishedSync([{...account,stages:fullStages(stage('standing_orders_detection','failed','failed','ERROR',0))}],'דוח אחד מחכה לאישור במסך הייבוא · לא נאספו: פרטי הלוואות, זיהוי הוראות קבע, אימות הוראות קבע, מסמכי בנק — ראו פירוט',true));
 await expect(standing.getByRole('listitem').filter({hasText:'זיהוי החיובים החוזרים נכשל — התנועות עצמן נקלטו כרגיל'}).locator('.sync-stage-status')).toHaveText('מצב: נכשל');
 await expect(standing.locator('.sync-journey-steps').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו')).toBeVisible();
});

// Banker: a table read with rows we could not place may hide a loan, so it never reads as plain success.
test('A bank page read with unrecognised rows says how many, waits for approval, and leaves the sync incomplete',async({page})=>{
 const [account]=outcome('ready_for_review');
 const unrecognized=(name:string,count:number,rejected:number)=>({...stage(name,'partial','awaiting_approval','ROWS_UNRECOGNIZED',count),rejected});
 const cases:Array<[number,number,string,string]>=[
  [1,2,'נקראו 2 מסלולי הלוואה מאתר הבנק, ושורה אחת בטבלה לא זוהתה — ייתכן שחסרה הלוואה. כדאי להשוות לדף הבנק','נקראו 3 הוראות קבע מאתר הבנק, ו־2 שורות לא זוהו — ייתכן שחסרה הוראה'],
  [3,1,'נקראו 2 מסלולי הלוואה מאתר הבנק, ו־3 שורות בטבלה לא זוהו — ייתכן שחסרה הלוואה. כדאי להשוות לדף הבנק','נקראו 3 הוראות קבע מאתר הבנק, ושורה אחת לא זוהתה — ייתכן שחסרה הוראה'],
 ];
 for(const [loansRejected,ordersRejected,loansText,ordersText] of cases){
  const stages=[stage('checking','done','done',null,9),stage('loan_detection','done','done',null,1),VISITED,unrecognized('loan_details',2,loansRejected),stage('loan_schedule_import','skipped','not_needed',null,0),
   stage('standing_orders_detection','done','done','INFERRED',3),unrecognized('standing_orders_verification',3,ordersRejected),stage('bank_documents','blocked','blocked','NOT_APPROVED')];
  const dialog=await openSummary(page,finishedSync([{...account,stages}],'דוח אחד מחכה לאישור במסך הייבוא · לא נאספו: פרטי הלוואות, אימות הוראות קבע, מסמכי בנק — ראו פירוט',true));
  const list=dialog.getByRole('region',{name:'שלבי הסנכרון'});
  for(const text of [loansText,ordersText]){
   const line=list.getByRole('listitem').filter({hasText:text});
   await expect(line).toHaveCount(1);
   await expect(line).toHaveText(`◐${text}מצב: ממתין לאישור`);
   await expect(line).not.toHaveClass(/sync-stage-done/);
  }
  await expect(list).not.toContainText(/מחכ(ים|ות) לאישורך/);
  await expect(dialog.locator('.sync-journey-steps').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו')).toBeVisible();
  await expect(dialog.getByText('הסנכרון הושלם',{exact:false})).toHaveCount(0);
  await page.unrouteAll({behavior:'ignoreErrors'});
 }
});

// The status and the "incomplete" verdict are the server's: the page shows them and never derives its own.
test('The page follows the server\'s incomplete flag, and a stage without a status still shows its text',async({page})=>{
 const [account]=outcome('ready_for_review');
 const old=await openSummary(page,finishedSync([{...account,stages:[{stage:'checking',state:'done',code:null,count:9},{stage:'loan_details',state:'blocked',code:'NOT_APPROVED'}]}],'דוח אחד מחכה לאישור במסך הייבוא'));
 const stages=old.getByRole('region',{name:'שלבי הסנכרון'});
 await expect(stages.getByText('התנועות בעו״ש נקראו')).toBeVisible();
 await expect(stages.getByText(BLOCKED)).toBeVisible();
 await expect(stages.locator('.sync-stage-status')).toHaveCount(0);
 await expect(stages).not.toContainText('undefined');
 await page.unrouteAll({behavior:'ignoreErrors'});
 // Statuses that look complete, but the server says a gap remains: its word stands.
 const flagged=await openSummary(page,finishedSync([{...account,stages:[stage('checking','done','done',null,9)]}],'דוח אחד מחכה לאישור במסך הייבוא',true));
 await expect(flagged.locator('.sync-journey-steps').getByText('העו״ש סונכרן — חלק מהנתונים לא נאספו')).toBeVisible();
 await page.unrouteAll({behavior:'ignoreErrors'});
 const complete=await openSummary(page,finishedSync([{...account,stages:[stage('checking','done','done',null,9),stage('loan_detection','partial','awaiting_approval','AMBIGUOUS',1)]}],'דוח אחד מחכה לאישור במסך הייבוא',false));
 await expect(complete.locator('.sync-journey-steps').getByText('הסנכרון הושלם')).toBeVisible();
 await expect(complete.getByRole('listitem').filter({hasText:'1 חיובי הלוואה לא שויכו להלוואה אחת'}).locator('.sync-stage-status')).toHaveText('מצב: ממתין לאישור');
});

// §7 A2: what the bank's own loans and standing-orders pages showed waits for her approval, like a schedule.
const siteItem=(kind:string,key:string,target:string,session:string,status='ready_for_review')=>({kind,key,importSessionId:session,target,rows:2,skippedPending:0,skippedForeign:0,skippedZero:0,storedThrough:null,pending:[],foreign:[],
 review:{status,counts:{included:0,duplicate:0,pending:0}}});
const SITE_STAGES=[stage('checking','done','done',null,9),stage('loan_detection','done','done',null,1),VISITED,stage('loan_details','done','done',null,2),stage('loan_schedule_import','skipped','not_needed',null,0),
 stage('standing_orders_detection','done','done','INFERRED',3),stage('standing_orders_verification','done','done',null,4),stage('bank_documents','blocked','blocked','NOT_APPROVED')];
test('Loan details and standing orders read from the bank site link to their own review, apart from the account\'s transactions',async({page},info)=>{
 const [account]=outcome('ready_for_review');
 const dialog=await openSummary(page,finishedSync([{...account,stages:SITE_STAGES},siteItem('loan_details','loan_details','פרטי הלוואות מאתר הבנק','s-3'),siteItem('standing_orders','standing_orders','הוראות קבע מאתר הבנק','s-4')],'דוח אחד מחכה לאישור במסך הייבוא',true));
 const site=dialog.getByRole('region',{name:'פרטים מאתר הבנק לאישור'});
 await expect(site.getByRole('link',{name:'לבדיקה ואישור: פרטי הלוואות מאתר הבנק'})).toHaveAttribute('href','/imports?session=s-3');
 await expect(site.getByRole('link',{name:'לבדיקה ואישור: הוראות קבע מאתר הבנק'})).toHaveAttribute('href','/imports?session=s-4');
 const stages=dialog.getByRole('region',{name:'שלבי הסנכרון'});
 await expect(stages.getByText('נקראו פרטים של 2 מסלולי הלוואה מאתר הבנק — מחכים לאישורך')).toBeVisible();
 await expect(stages.getByText('נקראו 4 הוראות קבע והרשאות מאתר הבנק — מחכות לאישורך')).toBeVisible();
 // The site items carry no rows: only the account's own list shows counts.
 await expect(site.getByText(/ייכנסו באישור/)).toHaveCount(0);
 await expect(dialog.getByText('ייכנסו באישור: 5',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('sync-site-snapshot.png')});
 expect(await axeSerious(page)).toEqual([]);
 await page.unrouteAll({behavior:'ignoreErrors'});
 const [approved]=outcome('completed');
 const done=await openSummary(page,finishedSync([{...approved,stages:SITE_STAGES},siteItem('loan_details','loan_details','פרטי הלוואות מאתר הבנק','s-3','completed')],'',false));
 await expect(done.getByText('נוספו 5 תנועות.')).toBeVisible();
});

test('A bank-site page with no known table, a failed read and a skipped one each say so, with the server\'s status',async({page})=>{
 const [account]=outcome('ready_for_review');
 const cases:Array<[Row,string,string]>=[
  [stage('loan_details','failed','unavailable','UNAVAILABLE'),'הדף נפתח, אבל לא זיהינו בו טבלה מוכרת — לא נקרא דבר','מצב: לא זמין'],
  [stage('loan_details','failed','failed','FAILED'),'קריאת הדף נכשלה — לא ניסינו שוב','מצב: נכשל'],
  [stage('standing_orders_verification','failed','unavailable','UNAVAILABLE'),'הדף נפתח, אבל לא זיהינו בו טבלה מוכרת — לא נקרא דבר','מצב: לא זמין'],
  [stage('standing_orders_verification','failed','failed','FAILED'),'קריאת הדף נכשלה — לא ניסינו שוב','מצב: נכשל'],
  [stage('standing_orders_verification','failed','failed','SESSION_LOST'),'לא הגענו לדף: הבנק ניתק את הכניסה — לא ניסינו שוב','מצב: נכשל'],
  [stage('standing_orders_verification','skipped','not_needed','NOT_NEEDED'),'לא נדרשה קריאה של הוראות הקבע מאתר הבנק','מצב: לא נדרש'],
  [stage('standing_orders_verification','blocked','blocked','NOT_APPROVED'),STANDING_BLOCKED,'מצב: חסום במדיניות'],
 ];
 for(const [row,text,status] of cases){
  const dialog=await openSummary(page,finishedSync([{...account,stages:[stage('checking','done','done',null,9),row]}],'דוח אחד מחכה לאישור במסך הייבוא',true));
  const line=dialog.getByRole('region',{name:'שלבי הסנכרון'}).getByRole('listitem').filter({hasText:text});
  await expect(line).toHaveCount(1);
  await expect(line.locator('.sync-stage-status')).toHaveText(status);
  await expect(dialog.getByText('עדיין לא אושר',{exact:false})).toHaveCount(0);
  await page.unrouteAll({behavior:'ignoreErrors'});
 }
});
