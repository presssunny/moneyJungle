import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';

test.skip(process.env.MONEY_JUNGLE_ASSISTANT_E2E !== '1', 'Opt-in assistant real API checks');
const backend = resolve(process.cwd(), '../backend');
function fixture(...args: string[]) { return execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/testing/designFixture.ts', ...args], { cwd: backend, encoding: 'utf8' }); }
function seed(userId: number) {
  execFileSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `const {prisma}=require('./src/config/database');const {businessDate}=require('./src/utils/date.utils');(async()=>{await prisma.expense.createMany({data:[1,2].map(()=>({userId:${userId},businessName:'רישום כפול לבדיקה — שם בית עסק ארוך במיוחד של קניות המשפחה',amount:123.45,expenseDate:new Date(businessDate())}))});})().finally(()=>prisma.$disconnect());`], { cwd: backend, encoding: 'utf8' });
}

for (const mode of ['empty', 'partial', 'dense']) test(`Assistant real account: ${mode}`, async ({ page, context }, info) => {
  test.setTimeout(180000);
  const identity = JSON.parse(fixture('create', mode)) as { userId: number; token: string };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const artifacts = resolve(process.cwd(), '../docs/research/screenshots');
  mkdirSync(artifacts, { recursive: true });
  try {
    if (mode !== 'empty') seed(Number(identity.userId));
    await context.addCookies([{ name: 'mj_session', value: identity.token, url: 'http://127.0.0.1:5185', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/manage');
    await page.getByRole('heading', { name: 'העוזר המשפחתי' }).locator('..').locator('..').getByRole('link', { name: 'פתיחה ←' }).click();
    await expect(page.getByRole('heading', { name: 'עושים סדר בכסף של המשפחה' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'הצעדים הבאים', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveCSS('direction', 'rtl');
    if (mode === 'empty') await expect(page.getByRole('link', { name: 'בניית תמונת הכסף' })).toBeVisible();
    else {
      await expect(page.locator('#duplicates')).toContainText('רישום כפול לבדיקה');
      const popupPromise = page.waitForEvent('popup');
      await page.locator('#duplicates a').first().click();
      const source = await popupPromise;
      await expect(source).toHaveURL(/transactions.*q=/);
      await expect(source.getByRole('cell', { name: 'רישום כפול לבדיקה — שם בית עסק ארוך במיוחד של קניות המשפחה', exact: true }).first()).toBeVisible();
      await source.close();
      await page.goto('/assistant');
      await expect(page.getByRole('heading', { name: 'הצעדים הבאים', exact: true })).toBeVisible();
    }
    await page.getByText('בחירת צעדים בעזרת AI', { exact: true }).click();
    await expect(page.getByText('חיבור ה־AI עדיין לא מוגדר.', { exact: false })).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('בחירת צעדים בעזרת AI', { exact: true }).click();
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: resolve(artifacts, `${mode}-assistant-${info.project.name}.png`), fullPage: true });
    if (mode === 'dense') {
      const session = await (await page.request.get('/api/gate/session')).json();
      for (const theme of ['neon-purple', 'dark-luxury', 'red-cyan', 'ocean', 'forest', 'sunset', 'rose-gold', 'light']) {
        const response = await page.request.patch('/api/settings', { headers: { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:5185' }, data: { theme } });
        expect(response.ok()).toBe(true);
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { name: 'הצעדים הבאים', exact: true })).toBeVisible();
        expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, theme).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), theme).toBe(true);
        await page.getByRole('button', { name: 'בדיקת הרישומים', exact: true }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByRole('radio', { name: 'רישום ידני נוסף בטעות' })).toBeEnabled();
        await dialog.getByRole('radio', { name: 'רישום ידני נוסף בטעות' }).check();
        expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations, `${theme} review dialog`).toEqual([]);
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), theme).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'רענון הבדיקה' }).focus();
      await expect(page.getByRole('button', { name: 'רענון הבדיקה' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: 'רענון הבדיקה' })).toBeEnabled();
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      if (info.project.name === 'desktop') {
        await page.setViewportSize({ width: 820, height: 1180 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: resolve(artifacts, 'dense-assistant-tablet.png'), fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  } finally { fixture('remove', String(identity.userId)); }
});

test('Duplicate review persists, corrects totals exactly once and restores the original record', async ({ page, context }, info) => {
  const identity = JSON.parse(fixture('create', 'empty')) as { userId: number; token: string };
  try {
    seed(Number(identity.userId));
    await context.addCookies([{ name: 'mj_session', value: identity.token, url: 'http://127.0.0.1:5185', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/assistant');
    const session = await (await page.request.get('/api/gate/session')).json();
    const auth = { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:5185' };
    const snapshot = async () => (await page.request.get('/api/household-assistant', { headers: auth })).json();
    const before = await snapshot();
    const candidate = before.duplicates.candidates[0];
    const button = page.getByRole('button', { name: 'בדיקת הרישומים', exact: true });
    await button.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'שמירת ההחלטה' })).toBeDisabled();
    await dialog.getByRole('radio', { name: 'אלה עסקאות נפרדות' }).check();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'שמירת ההחלטה' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#duplicates')).toContainText('אין רישומים שממתינים');
    await page.reload();
    await expect(page.locator('#duplicate-history')).toContainText('עסקאות נפרדות');
    expect((await snapshot()).totals).toEqual(before.totals);
    await page.getByRole('button', { name: 'פתיחה מחדש לבדיקה' }).click();
    await page.getByRole('button', { name: 'אישור ופתיחה מחדש' }).click();
    await expect(button).toBeVisible();
    await button.focus(); await page.keyboard.press('Enter');
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio', { name: 'רישום ידני נוסף בטעות' })).toBeEnabled();
    await dialog.getByRole('radio', { name: 'רישום ידני נוסף בטעות' }).check();
    await dialog.getByLabel('איזה רישום להסיר?').selectOption(candidate.records[0].key);
    await dialog.getByLabel('איזו רשומה נשארת?').selectOption(candidate.records[1].key);
    await expect(dialog).toContainText('יקטנו בסכום הזה');
    const confirm = dialog.getByRole('button', { name: 'אישור והסרת הרישום שנבחר' });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await confirm.focus(); await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'סגירה', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(confirm).toBeFocused();
    expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: resolve(process.cwd(), '../docs/research/screenshots', `duplicate-review-${info.project.name}.png`), fullPage: true });
    await page.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'ביטול התיקון ושחזור' })).toBeEnabled();
    expect((await snapshot()).totals.expenseTotal).toBe(before.totals.expenseTotal - 123.45);
    await page.reload();
    await page.getByRole('button', { name: 'ביטול התיקון ושחזור' }).click();
    await expect(page.getByRole('dialog')).toContainText('יגדלו ב־');
    await page.getByRole('button', { name: 'אישור ושחזור הרישום' }).click();
    await expect(button).toBeVisible();
    expect((await snapshot()).totals).toEqual(before.totals);
    await expect(page.locator('#duplicate-history')).toContainText('ההחלטה בוטלה');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { fixture('remove', String(identity.userId)); }
});

test('Duplicate review rejects changed evidence in an open dialog and supports a fresh explicit decision', async ({ page, context }) => {
  const identity = JSON.parse(fixture('create', 'empty')) as { userId: number; token: string };
  try {
    seed(Number(identity.userId));
    await context.addCookies([{ name: 'mj_session', value: identity.token, url: 'http://127.0.0.1:5185', httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/assistant');
    const session = await (await page.request.get('/api/gate/session')).json();
    const auth = { 'X-CSRF-Token': session.csrfToken, Origin: 'http://127.0.0.1:5185' };
    const snapshot = await (await page.request.get('/api/household-assistant', { headers: auth })).json();
    const record = snapshot.duplicates.candidates[0].records[0];
    await page.getByRole('button', { name: 'בדיקת הרישומים' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'אלה עסקאות נפרדות' }).check();
    await dialog.getByRole('checkbox').check();
    const response = await page.request.patch(`/api/expenses/${record.key.split(':')[1]}`, { headers: auth, data: { description: 'מקור מעודכן' } });
    expect(response.ok()).toBe(true);
    await dialog.getByRole('button', { name: 'שמירת ההחלטה' }).click();
    await expect(dialog.getByRole('alert')).toContainText('הרשומות השתנו');
    await dialog.getByRole('button', { name: 'רענון הרשומות' }).click();
    await expect(dialog.getByRole('checkbox')).not.toBeChecked();
    await expect(dialog.getByRole('button', { name: 'שמירת ההחלטה' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'שמירת ההחלטה' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('#duplicate-history')).toContainText('עסקאות נפרדות');
  } finally { fixture('remove', String(identity.userId)); }
});
