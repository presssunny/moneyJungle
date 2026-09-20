import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.MONEY_JUNGLE_DESIGN_E2E !== '1','Opt-in real-data visual audit');
const phase=process.env.MJ_DESIGN_PHASE??'after';
const artifacts=resolve(process.cwd(),'../docs/design/screenshots',phase);
const backend=resolve(process.cwd(),'../backend');
function fixture(...args:string[]){return execFileSync(process.execPath,['-r','ts-node/register/transpile-only','src/testing/designFixture.ts',...args],{cwd:backend,encoding:'utf8'});}
const routes=[['home','/'],['transactions','/transactions'],['budget','/budgets'],['accounts','/accounts?tab=bank'],['credit','/accounts?tab=credit'],['loans','/accounts?tab=loans'],['reports','/reports'],['forecast','/reports?tab=forecast'],['net-worth','/accounts?tab=assets'],['imports','/imports'],['setup','/onboarding'],['settings','/settings'],['alerts','/alerts'],['data','/data']];
for(const mode of ['empty','partial','dense'])test(`Real design audit: ${mode}`,async({page,context},testInfo)=>{
 test.setTimeout(240000);
 const identity=JSON.parse(fixture('create',mode));
 mkdirSync(artifacts,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  await context.addCookies([{name:'mj_session',value:identity.token,url:'http://127.0.0.1:5174',httpOnly:true,sameSite:'Lax'}]);
  for(const [name,path] of routes){
   await page.goto(path+(path.includes('?')?'&':'?')+`month=${identity.month}`);
   await expect(page.locator('main')).toBeVisible();
   await page.waitForLoadState('networkidle');
   await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:resolve(artifacts,`${mode}-${name}-${testInfo.project.name}.png`),fullPage:true});
   if(phase==='after'){
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflows`).toBe(true);
    await expect(page.locator('html')).toHaveCSS('direction','rtl');
   }
  }
  expect(errors).toEqual([]);
 }finally{fixture('remove',String(identity.userId));}
});

const themeLabels:Record<string,string>={'neon-purple':'סגול ניאון','dark-luxury':'כהה יוקרתי','red-cyan':'אדום / ציאן',ocean:'עומק האוקיינוס',forest:'יער לילה',sunset:'שקיעה','rose-gold':'ורד-זהב',light:'יום בהיר'};
const themes=['neon-purple','dark-luxury','red-cyan','ocean','forest','sunset','rose-gold','light'];
test('Real populated screens preserve hierarchy and accessibility in every theme',async({page,context},testInfo)=>{
 test.skip(phase==='before');test.setTimeout(600000);
 const identity=JSON.parse(fixture('create','dense'));
 const findings:unknown[]=[];
 try{
  await context.addCookies([{name:'mj_session',value:identity.token,url:'http://127.0.0.1:5174',httpOnly:true,sameSite:'Lax'}]);
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const theme of themes){
   await page.goto('/settings');
   const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings')&&r.request().method()==='PATCH');
   await page.locator('.theme-card').filter({hasText:themeLabels[theme]}).click();
   expect((await saved).ok()).toBe(true);
   for(const [name,path] of routes){
    await page.goto(path+(path.includes('?')?'&':'?')+`month=${identity.month}`);
    await page.waitForLoadState('networkidle');await page.evaluate(()=>document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${theme}/${name}: overflow`).toBe(true);
    const audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    if(audit.violations.length)findings.push({theme,name,violations:audit.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))}))});
    writeFileSync(resolve(artifacts,`accessibility-${testInfo.project.name}.json`),JSON.stringify(findings,null,2));
    if(['home','transactions','budget','reports','setup'].includes(name))await page.screenshot({path:resolve(artifacts,`theme-${theme}-${name}-${testInfo.project.name}.png`),fullPage:true});
   }
   // Resolve color-mix in the browser, including control boundaries and states.
   const pairs=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d')!;
    const probe=document.createElement('span');document.body.append(probe);
    const luminance=(token:string)=>{probe.style.color=`var(${token})`;ctx.fillStyle=getComputedStyle(probe).color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
    const pairs=[['--text','--surface',4.5],['--text-muted','--surface',4.5],['--text-muted','--bg',4.5],['--primary','--surface-selected',4.5],['--primary-contrast','--primary',4.5],['--danger','--surface',4.5],['--success','--surface',4.5],['--warning','--surface',4.5],['--outline-control','--surface',3]] as const;
    const result=pairs.map(([fg,bg,min])=>{const a=luminance(fg),b=luminance(bg);return{fg,bg,min,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});probe.remove();return result;
   });
   for(const pair of pairs)if(pair.ratio<pair.min)findings.push({theme,pair});
  }
  writeFileSync(resolve(artifacts,`accessibility-${testInfo.project.name}.json`),JSON.stringify(findings,null,2));
  expect(findings).toEqual([]);
 }finally{fixture('remove',String(identity.userId));}
});

test('Real filters, keyboard focus, tablet and narrow RTL layouts',async({page,context},testInfo)=>{
 test.skip(phase==='before');test.setTimeout(180000);
 const identity=JSON.parse(fixture('create','dense'));
 try{
  await context.addCookies([{name:'mj_session',value:identity.token,url:'http://127.0.0.1:5174',httpOnly:true,sameSite:'Lax'}]);
  await page.goto(`/transactions?month=${identity.month}`);
  await expect(page.getByRole('cell',{name:/מרפאת מומחים/}).first()).toBeVisible();
  await expect(page.getByLabel('מתאריך',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'עוד מסננים'}).click();
  const recurring=page.getByLabel('רק תשלומים קבועים',{exact:true});await recurring.click();await expect(recurring).toBeChecked();
  await page.getByRole('button',{name:'עוד מסננים'}).click();
  await expect(page.getByRole('button',{name:'הסרת מסנן תשלומים קבועים'})).toBeVisible();
  await page.getByRole('button',{name:'הסרת מסנן תשלומים קבועים'}).click();
  await expect(page.getByRole('status').filter({hasText:'תנועות בסינון'})).toContainText('118');
  const edit=page.getByRole('button',{name:'עריכה',exact:true}).first();await edit.click();
  const input=page.getByRole('dialog').getByLabel('בית עסק');
  await input.fill('שם לבדיקה בלבד');await expect(input).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(edit).toBeFocused();
  await expect(edit).toHaveCSS('outline-style','solid');
  const expenses=page.getByRole('tab',{name:'הוצאות',exact:true});await expenses.focus();await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab',{name:'הכנסות',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowRight');await expect(expenses).toHaveAttribute('aria-selected','true');
  if(testInfo.project.name==='mobile'){
   const more=page.getByRole('button',{name:'עוד',exact:true});await more.click();
   const dialog=page.getByRole('dialog',{name:'עוד מסכים'});await expect(dialog).toBeVisible();
   await page.keyboard.press('Shift+Tab');await expect(dialog.getByRole('link',{name:'הגדרות וניהול'})).toBeFocused();
   await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'סגירה'})).toBeFocused();
   await page.keyboard.press('Escape');await expect(more).toBeFocused();
  }else{
   for(const width of [768,320]){
    await page.setViewportSize({width,height:1024});
    for(const [name,path] of routes){
     await page.goto(path+(path.includes('?')?'&':'?')+`month=${identity.month}`);await page.waitForLoadState('networkidle');
     expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${name}: overflow`).toBe(true);
     await page.screenshot({path:resolve(artifacts,`dense-${name}-${width}.png`),fullPage:true});
    }
   }
  }
 }finally{fixture('remove',String(identity.userId));}
});
