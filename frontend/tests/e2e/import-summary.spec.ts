import { test, expect, type Page } from '@playwright/test';
import type { ImportSession } from '../../src/types/journey.types';

const original = { date: '2026-09-10', name: 'תנועה מהדוח', amount: -100 };
function readySession(kind = 'bank'): ImportSession {
 return { id:'summary-test',fileName:'report.pdf',kind,status:'ready_for_review',version:4,answers:{kind,accountId:1},
  preview:{rows:[],count:117,total:0,questions:[],warnings:['היתרה בחשבון תחושב מהדף.'],validation:{balanceChecked:true,balanceMismatchCount:0,rejectedRowCount:0,reviewRowCount:0,balanceMode:'daily'}},result:null };
}
async function mockImport(page:Page, options:{initial?:ImportSession;pending?:number;failComplete?:boolean;editedCount?:number}={}) {
 let session=options.initial??readySession();let pending=options.pending??0;let failComplete=options.failComplete??false;
 const requests:{action:string;payload:unknown}[]=[];const filters:(string|null)[]=[];
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  let body:unknown=[];
  if(path==='/api/gate/session')body={user:{id:1,email:'test@example.test',displayName:'Test',role:'USER'},csrfToken:'x'};
  else if(path==='/api/settings')body={theme:'light',currency:'ILS',notificationsJson:{}};
  else if(path==='/api/journey/profile')body={onboarding:'completed'};
  else if(path==='/api/journey/home'||path==='/api/journey/status')body={profile:{onboarding:'completed'},balances:[{id:1,name:'עו״ש משפחתי',balance:0,explanation:'',anchor:null}],cards:[],sources:[],issues:[],blockers:[],actions:[],actionCount:0,coverageAcknowledged:false,events:[]};
  else if(path==='/api/loans')body={loans:[]};
  else if(path.endsWith('/rows')){
   const filter=url.searchParams.get('filter');filters.push(filter);
   const items=filter==='review'?(pending?[{id:117,rowNumber:117,original,normalized:original,resolution:'review',candidates:[{...original,id:9,kind:'bank'}],outputRef:null}]:[]):[{id:1,rowNumber:1,original,normalized:original,resolution:'include',candidates:[],outputRef:null}];
   body={items,total:filter==='review'?pending:117,pageSize:50,pendingCount:pending,counts:{included:117-pending,duplicate:0,pending},editedCount:options.editedCount??0};
  }else if(path.endsWith('/rows/117')){
   requests.push({action:'row',payload:request.postDataJSON()});pending=0;session={...session,version:session.version+1};body=session;
  }else if(path.endsWith('/answers')){
   requests.push({action:'answers',payload:request.postDataJSON()});session={...readySession(),version:session.version+1};body=session;
  }else if(path.endsWith('/commit')){
   requests.push({action:'commit',payload:request.postDataJSON()});session={...session,version:session.version+1,status:'review',result:session.kind==='credit'?{creditImportId:8}:{accountId:1}};body=session;
  }else if(path.endsWith('/complete')){
   requests.push({action:'complete',payload:request.postDataJSON()});
   if(failComplete)return route.fulfill({status:503,json:{error:{message:'אפשר לנסות שוב.'}}});
   session={...session,version:session.version+1,status:'completed'};body=session;
  }else if(path.includes('/imports/sessions/'))body=session;
  await route.fulfill({json:body});
 });
 return {requests,filters,retryCompletion:()=>{failComplete=false;}};
}

test('A verified 117-row report needs one approval and keeps optional details closed',async({page},info)=>{
 const mocked=await mockImport(page);await page.goto('/imports?session=summary-test');
 await expect(page.getByText('יתרות סוף היום תואמות לתנועות שנקראו.')).toBeVisible();
 await expect(page.getByText('117 תנועות להוספה · 0 כבר קיימות · 0 דורשות החלטה')).toBeVisible();
 await expect(page.getByRole('table')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
 await expect(page.getByText('היתרה בחשבון תחושב מהדף.',{exact:true})).toBeHidden();
 await expect(page.getByRole('button',{name:/בדיקת שורה/})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('import-summary.png'),fullPage:true});
 await page.getByRole('button',{name:'הוספת התנועות',exact:true}).click();
 await expect(page.getByText('הייבוא הושלם.')).toBeVisible();
 expect(mocked.requests).toEqual([{action:'commit',payload:{version:4}},{action:'complete',payload:{version:5}}]);
 await expect(page.getByRole('link',{name:'דוחות ואפשרות ביטול הייבוא'})).toBeVisible();
});

test('Only a duplicate on source row 117 opens for review and blocks approval until resolved',async({page})=>{
 const mocked=await mockImport(page,{pending:1});await page.goto('/imports?session=summary-test');
 await expect(page.getByRole('button',{name:'בדיקת שורה 117'})).toBeVisible();
 await expect(page.getByRole('button',{name:'הוספת התנועות',exact:true})).toBeDisabled();
 expect(mocked.filters[0]).toBe('review');
 await expect(page.getByRole('button',{name:'הבא',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'בדיקת שורה 117'}).click();
 await page.getByRole('button',{name:'זו אותה תנועה — לא להוסיף שוב'}).click();
 await expect(page.getByRole('button',{name:'הוספת התנועות',exact:true})).toBeEnabled();
 await expect(page.getByRole('table')).toHaveCount(0);
 expect(mocked.requests[0]).toEqual({action:'row',payload:{version:4,resolution:'duplicate',candidateId:9,candidateKind:'bank'}});
 await page.getByRole('button',{name:'צפייה בכל 117 התנועות'}).click();
 await expect(page.getByRole('button',{name:'פרטי שורה 1'})).toBeVisible();
 expect(mocked.filters.at(-1)).toBeNull();
});

test('A saved blocked report can be reread with the existing answers and version',async({page})=>{
 const initial=readySession();initial.status='failed';initial.preview.validation={balanceChecked:true,balanceMismatchCount:87,rejectedRowCount:0,reviewRowCount:87};initial.preview.blockingIssues=['לא הצלחנו לאמת את יתרות הדוח.'];initial.preview.details=['אי-התאמת יתרה בשורה 3 (2026-09-02 תנועה): צפוי 80, מודפס 79, פער 1'];
 const mocked=await mockImport(page,{initial});await page.goto('/imports?session=summary-test');
 await expect(page.getByRole('alert').filter({hasText:'לא הצלחנו לאמת'})).toBeVisible();
 await expect(page.getByRole('button',{name:'הוספת התנועות',exact:true})).toHaveCount(0);
 await expect(page.getByText(/יתרות סוף היום תואמות/)).toHaveCount(0);
 await expect(page.getByText(/צפוי 80, מודפס 79/)).toBeHidden();
 await page.getByText('פירוט השורות שלא אומתו (1)').click();await expect(page.getByText(/צפוי 80, מודפס 79/)).toBeVisible();
 await expect(page.getByText(/תנועות נקראו/)).toBeVisible();
 await expect(page.getByText(/יבטלו את התיקונים|תבטל תיקונים/)).toHaveCount(0);
 await page.getByRole('button',{name:'בדיקה מחדש של הקובץ'}).click();
 await expect(page.getByRole('button',{name:'הוספת התנועות',exact:true})).toBeEnabled();
 expect(mocked.requests).toEqual([{action:'answers',payload:{version:4,answers:{kind:'bank',accountId:1}}}]);
});

test('Completion failure preserves the committed import and retry never commits twice',async({page})=>{
 const mocked=await mockImport(page,{failComplete:true});await page.goto('/imports?session=summary-test');
 await page.getByRole('button',{name:'הוספת התנועות',exact:true}).click();
 await expect(page.getByRole('alert').filter({hasText:'התנועות נוספו ונשמרו'})).toBeVisible();
 await expect(page.getByRole('button',{name:'הוספת התנועות',exact:true})).toHaveCount(0);
 mocked.retryCompletion();await page.getByRole('button',{name:'השלמת הייבוא'}).click();
 await expect(page.getByText('הייבוא הושלם.')).toBeVisible();
 expect(mocked.requests.map(r=>r.action)).toEqual(['commit','complete','complete']);
 expect(mocked.requests[2].payload).toEqual({version:5});
});

test('Credit keeps its dedicated transaction approval and is never completed automatically',async({page})=>{
 const mocked=await mockImport(page,{initial:readySession('credit')});await page.goto('/imports?session=summary-test');
 await page.getByRole('button',{name:'הוספת התנועות',exact:true}).click();
 await expect(page.getByRole('heading',{name:'אישור עסקאות האשראי'})).toBeVisible();
 await expect(page.getByRole('link',{name:'פתיחת התנועות שנוספו'})).toHaveAttribute('href',/tab=credit&importId=8/);
 expect(mocked.requests.map(r=>r.action)).toEqual(['commit']);
});
