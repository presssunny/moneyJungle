import { test, expect, type Page } from '@playwright/test';
function picture(phase=3) {
 const next=phase===0?{id:'situation',title:'מה יש בתמונה שלך?',reason:'אפשר לעדכן בכל זמן.',to:'/onboarding#situation',priority:5}:phase===1?{id:'session:test',title:'נמשיך עם הדוח שלך',reason:'נשאר לבדוק את הדוח.',to:'/imports?session=test',priority:0}:phase===2?{id:'acknowledge',title:'מבט אחרון על המידע',reason:'נבדוק מה עדכני להיום.',to:'/data#confirm-picture',priority:40}:null;
 return {stage:phase===3?'reviewed':'building',inventoryKnown:phase>0,hasUsefulData:phase>0,sufficient:phase===3,requiredGaps:[],situation:phase?{bankAccounts:0,creditCards:0,loans:0,cashActivity:false}:null,next,actions:next?[next]:[],sources:[],capabilities:[{key:'daily',title:'אומדן להוצאה יומית',available:false,reason:'אין יתרת בנק מאומתת לתכנון מזומן'}],areas:[['bankAccounts','חשבונות בנק'],['creditCards','כרטיסי אשראי'],['loans','הלוואות']].map(([key,title])=>({key,title,actual:0,expected:phase?0:null,status:phase?'not_applicable':'unknown',to:'/accounts',importTo:'/imports'}))};
}
async function mockApi(page:Page,{pending=false,coverageAcknowledged=true}={}){
 let draft:{id:string;step:number}|null=null;let completedAt:string|null=null;
 let profile={onboarding:pending?'pending':'completed',scope:{accountsListed:true,cardsListed:true,commitmentsListed:true,manualOnly:false},cashBuffer:'0',essentialReserve:'0',savedReserve:'0'};
 let session:any=null;let expense:any=null;let removed=false;let editedRow:{name:string;amount:number;date:string}|null=null;
 const state=()=>({picture:picture(coverageAcknowledged?3:2),today:'2026-09-17',end:'2026-09-30',dataVersion:'a'.repeat(64),profile,sources:[],balances:[],cards:[],events:[],issues:[],blockers:['אין יתרה מאומתת'],coverageAcknowledged,allowance:{amount:null,shortfall:null,state:'unavailable',cash:0,reserves:0,essentialReserve:0,formula:'יתרה פחות התחייבויות',assumptions:['הכנסה שטרם התקבלה אינה נכללת']}});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();let body:any=[];
  if(path==='/api/gate/session')body={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')body={theme:'light',notificationsJson:{},currency:'ILS'};
  else if(path==='/api/journey/profile')body=profile;
  else if(path==='/api/journey/home')body={...state(),actions:[1,2,3].map(i=>({id:String(i),title:`פעולה ${i}`,to:`/review?item=${i}`,reason:'סיבה'})),actionCount:5,upcoming:[]};
  else if(path==='/api/journey/status')body=state();
  else if(path==='/api/journey/onboarding/defer'){profile={...profile,onboarding:'deferred'};body={ok:true};}
  else if(path==='/api/journey/onboarding/complete'){if(!session||session.status!=='completed')return route.fulfill({status:409,json:{error:{message:'יש להשלים את הקליטה'}}});profile={...profile,onboarding:'completed'};body=profile;}
  else if(path==='/api/dashboard/summary')body={incomeTotal:0,expenseTotal:expense&&!removed?expense.amount:0,balance:0,creditTotal:0,bankReview:{pendingCount:0},bankMonth:{debtReduction:0,cardSettled:0,internalTransfer:0,loanDrawdown:0}};
  else if(path==='/api/dashboard/attention')body=[1,2,3,4,5].map(i=>({id:String(i),text:`פעולה ${i}`,to:`/review?item=${i}`,tone:'info'}));
  else if(path==='/api/expenses/quick-add'){expense={id:7,amount:18,businessName:'קפה',categoryId:null,paymentMethodId:null,category:null,expenseDate:'2026-09-16',description:'נוסף בהקלדה מהירה',isRecurring:false};body={expense,parsed:{amount:18}};}
  else if(path==='/api/expenses/7'&&method==='PATCH'){expense={...expense,...req.postDataJSON()};body=expense;}
  else if(path==='/api/expenses/7'&&method==='DELETE'){removed=true;body={ok:true};}
  else if(path==='/api/expenses')body={expenses:expense&&!removed?[expense]:[],total:expense&&!removed?expense.amount:0,progress:{spent:0,target:null}};
  else if(path==='/api/incomes')body={incomes:[],total:0};
  else if(path==='/api/loans')body={loans:[],totals:{totalBalance:0}};
  else if(path==='/api/imports/sessions'&&method==='POST'){
   session={id:'00000000-0000-4000-8000-000000000001',fileName:'expenses.csv',kind:'expense_sheet',status:'needs_input',version:0,answers:{},preview:{rows:[{name:'קפה',amount:18,date:null}],count:1,total:18,warnings:['השורות ללא תאריך יירשמו לפי החודש שנבחר'],questions:['נדרש חודש']},result:null};body=session;
  }else if(path.endsWith('/answers')){session={...session,answers:req.postDataJSON().answers,version:1,status:'ready_for_review',preview:{...session.preview,questions:[]}};body=session;}
  else if(path.endsWith('/commit')){session={...session,status:'review',version:2,result:{details:{expenseIds:[7]}}};body=session;}
  else if(path.endsWith('/complete')&&path.includes('/imports/')){session={...session,status:'completed',version:3};body=session;}
  else if(path.endsWith('/rows/1')&&method==='PATCH'){editedRow=req.postDataJSON().normalized;session={...session,version:session.version+1};body=session;}
  else if(path.endsWith('/rows'))body={items:[{id:1,rowNumber:1,original:{name:'קפה',amount:18,date:null},normalized:editedRow??{name:'קפה',amount:18,date:session.answers.month?session.answers.month+'-01':null},resolution:'include',candidates:[],outputRef:null}],total:1,pageSize:50,pendingCount:0};
  else if(path.includes('/imports/sessions/'))body=session;
  else if(path==='/api/imports/sessions')body=session?[session]:[];
  else if(path==='/api/journey/check-in'&&method==='POST'){draft={id:'checkin-test',step:0};body=draft;}
  else if(path==='/api/journey/check-in/checkin-test'&&method==='PATCH'){draft={id:'checkin-test',step:req.postDataJSON().step};body={ok:true};}
  else if(path==='/api/journey/check-in/checkin-test/complete'){draft=null;completedAt='2026-09-18';body={status:'completed'};}
  else if(path==='/api/journey/check-in')body={draft,previousCompletedAt:completedAt,due:!completedAt,token:'b'.repeat(64),action:{title:'בדיקת המקורות',to:'/data',reason:'אין יתרה מאומתת'},status:{...state(),upcoming:[]},comparison:{baseline:true,added:0,late:0,changed:0,removed:0,cashChange:null,limited:false,historyChanged:null}};
  await route.fulfill({json:body});
 });
 return {isRemoved:()=>removed};
}

test('Home leads with a partial picture and three actions; charts load only when expanded',async({page})=>{
 await mockApi(page);let charts=0;page.on('request',r=>{if(r.url().includes('/dashboard/charts'))charts++;});
 await page.goto('/');await expect(page.getByText('התמונה עדיין חלקית')).toBeVisible();
 await expect(page.getByRole('link',{name:/^פעולה /})).toHaveCount(3);
 await expect(page.getByText('מותר להוציא היום')).toHaveCount(0);expect(charts).toBe(0);
 await expect(page).toHaveTitle('Money Jungle');
 await page.screenshot({path:`test-results/home-${test.info().project.name}.png`,fullPage:true});
});
test('Quick Add shows interpreted date and supports editing and immediate undo',async({page})=>{
 const mocked=await mockApi(page);await page.goto('/');
 await page.getByRole('textbox',{name:'הוספת הוצאה בשפה חופשית'}).fill('קפה 18 אתמול');await page.getByRole('button',{name:'הוספה',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'נשמרה הוצאה'})).toContainText(/16[./]09[./]2026/);
 await page.getByRole('button',{name:'עריכה',exact:true}).click();await page.getByRole('spinbutton',{name:'סכום (₪)'}).fill('20');await page.getByRole('button',{name:'שמירה',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'נשמרה הוצאה'})).toContainText('20');
 await page.getByRole('button',{name:'ביטול ההוספה'}).click();await expect(page.getByText('ההוספה בוטלה')).toBeVisible();expect(mocked.isRemoved()).toBe(true);
});
test('Upload questions survive reload, and completion follows review',async({page})=>{
 await mockApi(page,{pending:true});await page.goto('/onboarding');
 await page.getByRole('navigation',{name:'שלבי ההיכרות'}).getByRole('link',{name:/מוסיפים ובודקים/}).click();
 await page.locator('input[type=file]').setInputFiles({name:'expenses.csv',mimeType:'text/csv',buffer:Buffer.from('שם,סכום\nקפה,18')});
 await expect(page).toHaveURL(/session=/);await page.reload();await expect(page.getByText('נדרש חודש',{exact:true})).toBeVisible();
 await page.getByLabel('חודש לשורות ללא תאריך').fill('2026-09');await page.getByRole('button',{name:'בדיקת הפרטים'}).click();
 await page.getByRole('checkbox',{name:/בדקתי את השורות/}).check();await page.getByRole('button',{name:'קליטת הנתונים',exact:true}).click();
 await page.getByRole('button',{name:'בדקתי — סיום הקליטה'}).click();await expect(page.getByText('הקליטה והבדיקה הושלמו')).toBeVisible();
 await page.getByRole('link',{name:'השלמת ההיכרות'}).click();await page.getByRole('checkbox',{name:/בדקתי את הנתונים/}).check();await page.getByRole('button',{name:'סיום ההיכרות'}).click();await expect(page).toHaveURL(/\/$/);
});
test('Onboarding directs users to coverage review before offering completion',async({page})=>{
 await mockApi(page,{pending:true,coverageAcknowledged:false});await page.goto('/onboarding');
 await expect(page.getByRole('button',{name:'סיום ההיכרות'})).toHaveCount(0);
 await expect(page.getByRole('navigation',{name:'שלבי ההיכרות'}).getByRole('link',{name:/רואים את התמונה/})).toHaveAttribute('href','/onboarding#onboarding-action');
});
test('Legacy import and management links reach canonical destinations',async({page})=>{
 await mockApi(page);await page.goto('/transactions?tab=import');await expect(page).toHaveURL(/\/imports$/);
 await page.goto('/manage?tab=documents');await expect(page).toHaveURL(/\/data$/);
 await page.goto('/manage');await expect(page.getByRole('link',{name:'פתיחה ←'})).toHaveCount(5);
 await expect(page.locator('a[href="/assistant"]')).toBeVisible();
});

test('A staged row can be corrected before commit and survives reload',async({page})=>{
 await mockApi(page);await page.goto('/imports');
 await page.locator('input[type=file]').setInputFiles({name:'expenses.csv',mimeType:'text/csv',buffer:Buffer.from('שם,סכום\nקפה,18')});
 await page.getByLabel('חודש לשורות ללא תאריך').fill('2026-09');await page.getByRole('button',{name:'בדיקת הפרטים',exact:true}).click();
 await page.getByRole('button',{name:'בדיקת שורה 1'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('תיאור',{exact:true}).fill('קפה מתוקן');await dialog.getByLabel('סכום (₪)',{exact:true}).fill('20');
 await dialog.getByRole('button',{name:'זו תנועה נפרדת — שמירת השורה לקליטה'}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await page.reload();
 await expect(page.getByText('קפה מתוקן',{exact:true})).toBeVisible();
});

test('Weekly check-in resumes its step and saves the suggested action',async({page})=>{
 await mockApi(page);await page.goto('/check-in');await page.getByRole('button',{name:'תחילת הבדיקה השבועית'}).click();
 await page.getByRole('button',{name:'המשך',exact:true}).click();await page.reload();
 await expect(page.getByRole('heading',{name:'פתרון — רק מה שדורש תשומת לב'})).toBeVisible();
 await page.getByRole('button',{name:'המשך',exact:true}).click();await expect(page.getByRole('heading',{name:'הבנה — מה השתנה?'})).toBeVisible();
 await page.getByRole('button',{name:'המשך',exact:true}).click();await expect(page.getByRole('heading',{name:'פעולה — צעד אחד להמשך'})).toBeVisible();
 await page.getByRole('button',{name:'שמירת הבדיקה והצעד הבא'}).click();await expect(page.getByRole('status').filter({hasText:'הבדיקה נשמרה'})).toBeVisible();
});

test('Transaction filters survive reload and back without fetching analysis',async({page})=>{
 await mockApi(page);let incomes=0;let expenses=0;
 await page.route('**/api/expenses?**',async route=>{expenses++;await route.fulfill({json:{expenses:[{id:1,amount:20,businessName:'קפה',expenseDate:'2026-09-16',categoryId:null,isRecurring:true,source:'manual'},{id:1,amount:-5,businessName:'זיכוי',expenseDate:'2026-09-17',categoryId:1,isRecurring:false,source:'credit'}],total:15,progress:{}}});});
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/incomes')incomes++;});
 await page.goto('/transactions?tab=expenses&month=2026-09&q=קפה&uncat=1&recurring=1&from=2026-09-01&to=2026-09-30');
 await expect(page.getByLabel('חיפוש חופשי')).toHaveValue('קפה');
 await expect(page.getByRole('status').filter({hasText:'תנועות בסינון'})).toContainText('1 תנועות');
 expect(incomes).toBe(0);expect(expenses).toBe(1);
 await page.reload();await expect(page.getByLabel('רק תשלומים קבועים')).toBeChecked();
 await page.getByRole('button',{name:'ניקוי מסננים ✕'}).click();await expect(page.getByRole('status').filter({hasText:'תנועות בסינון'})).toContainText('2 תנועות');
 await page.goBack();await expect(page.getByLabel('חיפוש חופשי')).toHaveValue('קפה');
 await page.getByRole('tab',{name:/הכנסות/}).click();await expect(page).toHaveURL(/tab=incomes/);await page.goBack();await expect(page.getByRole('tab',{name:/הוצאות/})).toHaveAttribute('aria-selected','true');
});

test('Metric details load on demand and reject mixed-version pages',async({page})=>{
 await mockApi(page);let reads=0;
 await page.route('**/api/journey/metrics/**',async route=>{
  reads++;const query=new URL(route.request().url()).searchParams;
  if(query.get('page')==='2')return route.fulfill({status:409,json:{error:{message:'המקורות השתנו. יש לרענן את המספר ואת הפירוט'}}});
  await route.fulfill({json:{name:'cash',value:100,asOf:'2026-09-17',period:{from:'2026-09-17',to:'2026-09-30'},formula:'עוגן ועוד תנועות',coverage:'לפי המקורות הרשומים',assumptions:[],missingData:[],components:[{key:'bank:1',label:'יתרת מקור',value:100,to:'/accounts?tab=bank'}],sources:[],total:51,page:1,pageSize:50,dataVersion:'a'.repeat(64)}});
 });
 await page.goto('/');await expect(page.getByText('התמונה עדיין חלקית')).toBeVisible();expect(reads).toBe(0);
 await page.getByText('מקורות יתרות הבנק',{exact:true}).click();await expect(page.getByRole('link',{name:'יתרת מקור'})).toBeVisible();expect(reads).toBe(1);
 await page.getByRole('button',{name:'הבא',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'המקורות השתנו'})).toBeVisible();
 await expect(page.getByRole('link',{name:'יתרת מקור'})).toHaveCount(0);
});

test('All eight themes keep the product identity and persist selection',async({page})=>{
 await mockApi(page);let theme='light';let moneyReads=0;
 await page.route('**/api/settings',async route=>{if(route.request().method()==='PATCH')theme=route.request().postDataJSON().theme??theme;await route.fulfill({json:{theme,currency:'ILS',dateFormat:'DD/MM/YYYY'}});});
 page.on('request',r=>{if(/\/api\/(journey|expenses|incomes)\//.test(r.url()))moneyReads++;});
 await page.goto('/settings');
 const choices=[['neon-purple','סגול ניאון'],['dark-luxury','כהה יוקרתי'],['red-cyan','אדום / ציאן'],['ocean','עומק האוקיינוס'],['forest','יער לילה'],['sunset','שקיעה'],['rose-gold','ורד-זהב'],['light','יום בהיר']];
 const before=moneyReads;
 for(const [id,label] of choices){
  await page.getByRole('button',{name:new RegExp(label)}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',id);
  await expect(page.locator('.sidebar-logo')).toContainText('Money Jungle');
  await expect(page).toHaveTitle('Money Jungle');
  await expect.poll(()=>theme).toBe(id);
 }
 expect(moneyReads).toBe(before);await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});

test('Login uses the same name for every saved theme',async({page})=>{
 await mockApi(page);
 await page.route('**/api/gate/session',route=>route.fulfill({status:401,json:{error:{message:'נדרש חיבור'}}}));
 for(const theme of ['neon-purple','dark-luxury','red-cyan','ocean','forest','sunset','rose-gold','light']){
  await page.goto('/login');await page.evaluate(value=>localStorage.setItem('app_theme',value),theme);await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await expect(page.locator('.gate-logo')).toHaveText('Money Jungle');await expect(page).toHaveTitle('Money Jungle');
 }
});

test('Legacy links retain month, row, source and return destination',async({page})=>{
 await mockApi(page);
 await page.goto('/expenses?month=2026-08&q=test&returnTo=%2Freview');
 await expect(page).toHaveURL(/\/transactions\?/);expect(new URL(page.url()).searchParams.get('month')).toBe('2026-08');await expect(page.getByRole('link',{name:'חזרה לתהליך הבדיקה'})).toHaveAttribute('href','/review');
 await page.goto('/manage?tab=documents&source=bank&month=2026-08');
 await expect(page).toHaveURL(/\/data\?/);expect(new URL(page.url()).searchParams.get('source')).toBe('bank');
 await page.goto('/transactions?tab=import&session=00000000-0000-4000-8000-000000000001');
 await expect(page).toHaveURL(/\/imports\?session=/);
});

test('Onboarding guides upload, review and coverage without locally acknowledging anything', async ({ page }) => {
 await mockApi(page, {pending:true,coverageAcknowledged:false});
 let phase=0;let writes=0;
 page.on('request', req=>{if(req.method()==='POST'&&req.url().includes('/journey/'))writes++;});
 await page.route('**/api/imports/sessions', route=>route.fulfill({json:phase?[{id:'test',fileName:'expenses.csv',status:'review',kind:'expense_sheet'}]:[]}));
 await page.route('**/api/journey/status', route=>route.fulfill({json:{picture:picture(phase),profile:{onboarding:'pending',scope:phase===3?{manualOnly:false}:null},hasActivity:phase>0,coverageAcknowledged:phase===3,issues:phase===1?[{key:'session:test',blocking:true,title:'דוח לבדיקה',to:'/imports?session=test'}]:[],blockers:['אין יתרת בנק מאומתת לתכנון מזומן']}}));
 await page.goto('/onboarding');
 const nav=page.getByRole('navigation',{name:'שלבי ההיכרות'});
 await expect(nav.locator('[aria-current=step]')).toContainText('מכירים את הכסף');
 await expect(nav.getByText('בהמשך',{exact:true})).toHaveCount(2);
 await expect(page.getByRole('button',{name:'שמירה והמשך'})).toBeVisible();
 await expect(page.getByRole('link',{name:'מעדיפים להזין ידנית?'})).toHaveAttribute('href','/data');
 await expect(page.getByText('אין יתרת בנק מאומתת לתכנון מזומן',{exact:true}).first()).toBeHidden();
 await page.locator('.mj-onboarding-details summary').focus();await page.keyboard.press('Enter');
 await expect(page.getByText('אין יתרת בנק מאומתת לתכנון מזומן',{exact:true}).first()).toBeVisible();
 for(phase=1;phase<=3;phase++){
  await page.reload();
  await expect(nav.getByText('הושלם',{exact:true})).toHaveCount(phase);
  if(phase===1)await expect(page.getByRole('link',{name:'להמשך הדוח'})).toHaveAttribute('href','/imports?session=test');
  if(phase===2)await expect(page.getByRole('link',{name:'לבדיקת המידע שלי',exact:true})).toHaveAttribute('href','/data#confirm-picture');
  if(phase<3)await expect(page.getByRole('button',{name:'סיום ההיכרות'})).toHaveCount(0);
 }
 const finish=page.getByRole('button',{name:'סיום ההיכרות'});
 await expect(finish).toBeDisabled();
 await page.getByRole('checkbox',{name:/בדקתי את הנתונים/}).check();await expect(finish).toBeEnabled();
 expect(writes).toBe(0);
 phase=2;await page.reload();await expect(page.getByRole('link',{name:'לבדיקת המידע שלי',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'סיום ההיכרות'})).toHaveCount(0);
});

test('Onboarding supports all themes, narrow RTL layouts and reduced motion', async ({ page }) => {
 await mockApi(page,{pending:true,coverageAcknowledged:false});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/onboarding');await expect(page.locator('.mj-onboarding-action')).toBeVisible();
 for(const theme of ['neon-purple','dark-luxury','red-cyan','ocean','forest','sunset','rose-gold','light']){
  await page.evaluate(value=>document.documentElement.setAttribute('data-theme',value),theme);
  await expect(page.locator('.mj-onboarding')).toHaveCSS('direction','rtl');
  await expect(page.locator('.mj-onboarding-cta')).toHaveCSS('transition-duration','0s');
  const contrast=await page.locator('.mj-onboarding-cta').evaluate(element=>{
   const style=getComputedStyle(element);
   const luminance=(color:string)=>{const channels=color.match(/\d+/g)!.slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
   const values=[luminance(style.color),luminance(style.backgroundColor)].sort((a,b)=>a-b);return (values[1]+.05)/(values[0]+.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/onboarding-${theme}-${test.info().project.name}.png`,fullPage:true});
 }
 await page.setViewportSize({width:320,height:740});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.mj-onboarding-cta').focus();await expect(page.locator('.mj-onboarding-cta')).toBeFocused();
 await expect(page.locator('.mj-onboarding-cta')).toHaveCSS('outline-style','solid');
});

test('Onboarding preserves manual no-activity payload, server errors and access to home', async ({page})=>{
 await mockApi(page,{pending:true});let payload:unknown;let deferred=false;
 await page.route('**/api/journey/status', route=>route.fulfill({json:{picture:picture(),profile:{onboarding:'pending',scope:{manualOnly:true}},coverageAcknowledged:true,issues:[],blockers:[]}}));
 await page.route('**/api/journey/onboarding/complete',route=>{payload=route.request().postDataJSON();return route.fulfill({status:409,json:{error:{message:'הנתונים השתנו. יש לרענן לפני אישור העדכניות'}}});});
 await page.route('**/api/journey/onboarding/defer',async route=>{deferred=true;await route.fulfill({json:{ok:true}});});
 await page.goto('/onboarding');await page.getByRole('checkbox',{name:/בדקתי את הנתונים/}).check();
 await page.getByRole('checkbox',{name:/אין כרגע פעילות/}).check();
 await page.getByRole('button',{name:'סיום ההיכרות'}).click();
 await expect(page.getByRole('alert').filter({hasText:'הנתונים השתנו'})).toBeVisible();expect(payload).toEqual({reviewed:true,noActivity:true});
 await page.getByRole('link',{name:'להמשיך לבית עם המידע הקיים'}).click();await expect(page).toHaveURL(/\/$/);expect(deferred).toBe(false);
});

test('Onboarding keeps unknown answers distinct from zero and recovers from save errors', async ({page})=>{
 await mockApi(page,{pending:true,coverageAcknowledged:false});
 let saved=false;let reject=true;const payloads:unknown[]=[];
 await page.route('**/api/journey/status',route=>route.fulfill({json:{picture:picture(saved?2:0),profile:{onboarding:'pending',scope:null},hasActivity:false,coverageAcknowledged:false,issues:[],blockers:[]}}));
 await page.route('**/api/journey/situation',route=>{
  payloads.push(route.request().postDataJSON());
  if(reject)return route.fulfill({status:503,json:{error:{message:'לא הצלחנו לשמור. אפשר לנסות שוב.'}}});
  saved=true;return route.fulfill({json:{ok:true}});
 });
 await page.goto('/onboarding');
 await page.getByRole('spinbutton',{name:'חשבונות בנק',exact:true}).fill('0');
 await page.getByRole('button',{name:'שמירה והמשך'}).click();
 await expect(page.getByRole('alert').filter({hasText:'לא הצלחנו לשמור'})).toBeVisible();
 expect(payloads[0]).toEqual({bankAccounts:0,creditCards:null,loans:null,cashActivity:null});
 await expect(page.getByRole('spinbutton',{name:'חשבונות בנק',exact:true})).toHaveValue('0');
 for(const name of ['כרטיסי אשראי','הלוואות'])await page.getByRole('spinbutton',{name,exact:true}).fill('0');
 await page.getByRole('combobox',{name:'יש גם הוצאות במזומן או מחוץ לדוחות?'}).selectOption('no');
 reject=false;await page.getByRole('button',{name:'שמירה והמשך'}).click();
 await expect(page.getByRole('navigation',{name:'שלבי ההיכרות'}).locator('[aria-current=step]')).toContainText('רואים את התמונה');
 expect(payloads[1]).toEqual({bankAccounts:0,creditCards:0,loans:0,cashActivity:false});
 await expect(page.getByRole('button',{name:'סיום ההיכרות'})).toHaveCount(0);
});
