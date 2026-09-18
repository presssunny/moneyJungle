import { test, expect, type Page } from '@playwright/test';
async function mockApi(page:Page,{pending=false}={}){
 let profile={onboarding:pending?'pending':'completed',scope:{accountsListed:true,cardsListed:true,commitmentsListed:true,manualOnly:false},cashBuffer:'0',essentialReserve:'0',savedReserve:'0'};
 let session:any=null;let expense:any=null;let removed=false;
 const state=()=>({today:'2026-09-17',end:'2026-09-30',dataVersion:'a'.repeat(64),profile,sources:[],balances:[],cards:[],events:[],issues:[],blockers:['אין יתרה מאומתת'],allowance:{amount:null,shortfall:null,state:'unavailable',cash:0,reserves:0,essentialReserve:0,formula:'יתרה פחות התחייבויות',assumptions:['הכנסה שטרם התקבלה אינה נכללת']}});
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
  else if(path.includes('/imports/sessions/'))body=session;
  else if(path==='/api/imports/sessions')body=session?[session]:[];
  else if(path==='/api/journey/check-in')body={draft:null,previousCompletedAt:null,due:true,token:'b'.repeat(64),action:{title:'בדיקת המקורות',to:'/data'},status:state(),comparison:{baseline:true,added:0,late:0,changed:0,removed:0,cashChange:null}};
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
 await mockApi(page,{pending:true});await page.goto('/');await expect(page).toHaveURL(/onboarding/);
 await page.getByRole('link',{name:'העלאת דוח ראשון'}).click();
 await page.locator('input[type=file]').setInputFiles({name:'expenses.csv',mimeType:'text/csv',buffer:Buffer.from('שם,סכום\nקפה,18')});
 await expect(page).toHaveURL(/session=/);await page.reload();await expect(page.getByText('נדרש חודש',{exact:true})).toBeVisible();
 await page.getByLabel('חודש לשורות ללא תאריך').fill('2026-09');await page.getByRole('button',{name:'בדיקת הפרטים'}).click();
 await page.getByRole('checkbox',{name:/בדקתי את השורות/}).check();await page.getByRole('button',{name:'קליטת הנתונים',exact:true}).click();
 await page.getByRole('button',{name:'בדקתי — סיום הקליטה'}).click();await expect(page.getByText('הקליטה והבדיקה הושלמו')).toBeVisible();
 await page.getByRole('link',{name:'השלמת ההיכרות'}).click();await page.getByRole('checkbox',{name:/בדקתי את הנתונים/}).check();await page.getByRole('button',{name:'סיום ההיכרות'}).click();await expect(page).toHaveURL(/\/$/);
});
test('Legacy import and management links reach canonical destinations',async({page})=>{
 await mockApi(page);await page.goto('/transactions?tab=import');await expect(page).toHaveURL(/\/imports$/);
 await page.goto('/manage?tab=documents');await expect(page).toHaveURL(/\/data$/);
 await page.goto('/manage');await expect(page.getByRole('link',{name:'פתיחה ←'})).toHaveCount(4);
});
