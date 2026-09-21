import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

// Opt in with MONEY_JUNGLE_REAL_E2E=1 and the local API/database running.
// Only disposable users are created; every request in the browser hits the real API.
test.skip(process.env.MONEY_JUNGLE_REAL_E2E !== '1', 'Requires the local API and database');
const backend = resolve(process.cwd(), '../backend');
function fixture(code: string) {
 return execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `
  const {prisma}=require('./src/config/database');
  (async()=>{${code}})().finally(()=>prisma.$disconnect()).catch(e=>{console.error(e);process.exitCode=1});
 `], { cwd:backend, encoding:'utf8', env:process.env });
}

for (const mode of ['upload','manual','inactive-card'] as const) {
 test(`Real onboarding: ${mode}, coverage confirmation and completion`, async ({page,context},testInfo)=>{
  test.setTimeout(90000);
  const identity=JSON.parse(fixture(`
   const crypto=require('node:crypto');const token=crypto.randomBytes(32).toString('hex');
   const user=await prisma.user.create({data:{name:'__onboarding_browser_test',email:crypto.randomUUID()+'@example.test'}});
   await prisma.gateSession.create({data:{userId:user.id,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+600000)}});
   console.log(JSON.stringify({userId:user.id,token}));
  `).trim());
  try {
   if(mode==='inactive-card')fixture(`await prisma.creditCard.create({data:{userId:${Number(identity.userId)},name:'כרטיס ללא חיובים',issuer:'test',lastFour:'1234'}});`);
   await context.addCookies([{name:'mj_session',value:identity.token,url:'http://127.0.0.1:5174',httpOnly:true,sameSite:'Lax'}]);
   const {csrfToken}=await (await page.request.get('/api/gate/session')).json();
   const headers={'X-CSRF-Token':csrfToken};
   await page.goto('/onboarding');
   const nav=page.getByRole('navigation',{name:'שלבי ההיכרות'});
   await expect(nav.locator('[aria-current=step]')).toContainText('מכירים את הכסף');
   await page.screenshot({path:testInfo.outputPath(`real-${mode}-start.png`),fullPage:true});
   // Use the actual situation form; zero is explicit, never inferred from blank fields.
   for (const name of ['חשבונות בנק','כרטיסי אשראי','הלוואות']) await page.getByRole('spinbutton',{name,exact:true}).fill(mode==='inactive-card'&&name==='כרטיסי אשראי'?'1':'0');
   await page.getByRole('combobox',{name:'יש גם הוצאות במזומן או מחוץ לדוחות?'}).selectOption('no');
   await page.getByRole('button',{name:'שמירה והמשך'}).click();
   await expect(nav.getByText('הושלם',{exact:true})).toHaveCount(mode==='inactive-card'?1:2);
   await page.reload();
   await expect(nav.locator('[aria-current=step]')).toContainText(mode==='inactive-card'?'מוסיפים ובודקים':'רואים את התמונה');
   if(mode==='upload'){
    await nav.getByRole('link',{name:/מוסיפים ובודקים/}).click();
    const XLSX=createRequire(resolve(backend,'package.json'))('xlsx');
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['שם','סכום'],['קפה',18]]),'Data');
    await page.locator('input[type=file]').setInputFiles({name:'onboarding-demo.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'})});
    await expect(page).toHaveURL(/session=/);await page.reload();
    await page.getByRole('combobox',{name:'סוג המידע'}).selectOption('expense_sheet');
    await page.getByLabel('חודש לשורות ללא תאריך').fill('2026-09');
    await page.getByRole('button',{name:'בדיקת הפרטים',exact:true}).click();
    await page.getByRole('checkbox',{name:/בדקתי את השורות/}).check();
    await page.getByRole('button',{name:'קליטת הנתונים',exact:true}).click();
    await expect(page.getByRole('button',{name:'בדקתי — סיום הקליטה'})).toBeVisible();
    const importUrl=page.url();
    await page.goto('/onboarding');await expect(nav.locator('[aria-current=step]')).toContainText('מוסיפים ובודקים');
    await page.screenshot({path:testInfo.outputPath('real-review.png'),fullPage:true});
    await page.getByRole('link',{name:'להמשך הדוח'}).click();
    await expect(page).toHaveURL(new RegExp(new URL(importUrl).searchParams.get('session')!));
    await page.getByRole('button',{name:'בדקתי — סיום הקליטה'}).click();
    await page.getByRole('link',{name:'השלמת ההיכרות'}).click();
    await expect(nav.locator('[aria-current=step]')).toContainText('רואים את התמונה');
    await page.getByRole('link',{name:'לבדיקת המידע שלי',exact:true}).click();
   } else {
    if(mode==='inactive-card'){
     await page.getByRole('link',{name:'לבדיקת הפרטים',exact:true}).click();
     await expect(page).toHaveURL(/data#source-credit-/);
     await expect(page.getByRole('checkbox',{name:'אין כרגע חיובים שצריך לכלול עבור כרטיס ללא חיובים'})).toBeInViewport();
    }else await page.getByRole('link',{name:'מעדיפים להזין ידנית?'}).click();
    await page.getByRole('checkbox',{name:/אני בוחר\/ת בהזנה ידנית/}).check();
   }
   await page.getByRole('checkbox',{name:/בדקתי שכל החשבונות/}).check();
   // Saving changes the data version; confirmations are keyed to it, so wait for the refreshed status before ticking.
   const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/journey/status')&&r.request().method()==='GET');
   await page.getByRole('button',{name:'שמירת היקף התמונה והסכומים'}).click();
   await expect(page.getByRole('status').filter({hasText:'נשמר'})).toBeVisible();
   await refreshed;
   if(mode==='inactive-card'){
    const quiet=page.getByRole('checkbox',{name:'אין כרגע חיובים שצריך לכלול עבור כרטיס ללא חיובים'});
    await expect(quiet).not.toBeChecked();await quiet.click();await expect(quiet).toBeChecked();
   }
   for(const checkbox of await page.getByRole('checkbox',{name:/בדקתי את עדכניות/}).all())await checkbox.check();
   await page.getByRole('button',{name:'בדקתי — המידע מעודכן להיום'}).click();
   await expect.poll(async()=> (await (await page.request.get('/api/journey/status',{headers})).json()).coverageAcknowledged).toBe(true);
   await page.goto('/onboarding');await expect(nav.getByText('הושלם',{exact:true})).toHaveCount(3);
   const finish=page.getByRole('button',{name:'סיום ההיכרות'});await expect(finish).toBeDisabled();
   await page.getByRole('checkbox',{name:/בדקתי את הנתונים/}).check();
   if(mode!=='upload')await page.getByRole('checkbox',{name:/אין כרגע פעילות/}).check();
   await page.screenshot({path:testInfo.outputPath(`real-${mode}-finish.png`),fullPage:true});
   await finish.click();await expect(page).toHaveURL(/\/$/);await page.reload();await expect(page).toHaveURL(/\/$/);
   expect((await (await page.request.get('/api/journey/profile',{headers})).json()).onboarding).toBe('completed');
   if(mode==='inactive-card'){
    await page.goto('/onboarding');
    await page.getByText('מה כלול בתמונה שלי? · שינוי',{exact:true}).click();
    await page.getByRole('spinbutton',{name:/חשבונות בנק/}).fill('1');
    await page.getByRole('button',{name:'שמירת התמונה שלי',exact:true}).click();
    await expect(nav.locator('[aria-current=step]')).toContainText('מוסיפים ובודקים');
    await page.goto('/data');
    await expect(page.getByRole('checkbox',{name:'אין כרגע חיובים שצריך לכלול עבור כרטיס ללא חיובים'})).not.toBeChecked();
    expect((await (await page.request.get('/api/journey/status',{headers})).json()).coverageAcknowledged).toBe(false);
   }
  } finally {
   fixture(`
    const user=await prisma.user.findFirstOrThrow({where:{id:${Number(identity.userId)},name:'__onboarding_browser_test'}});
    const files=await prisma.importSession.findMany({where:{userId:user.id},select:{storagePath:true}});
    const docs=await prisma.document.findMany({where:{userId:user.id},select:{storagePath:true}});
    await prisma.user.delete({where:{id:user.id}});
    const {documentStorage}=require('./src/modules/documents/documentStorage.service');
    for(const path of new Set([...files,...docs].map(f=>f.storagePath).filter(Boolean))) await documentStorage.remove(path);
   `);
  }
 });
}
