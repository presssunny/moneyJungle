# ביקורת ארכיטקטורה — Backend

תאריך: 2026-08-01 · היקף: `backend/src` (11,295 שורות, 20 מודולים, 118 קבצים)
מטרה: הפחתת חוב טכני בלי שינוי התנהגות, בלי Rewrite, בהדרגה.

---

## 0. השורה התחתונה מראש

**הארכיטקטורה הנוכחית טובה יותר ממה שציפית.** שלושת הדברים שביקשת לוודא שלא קורים — SQL ב־Controllers, Express ב־Services, לוגיקה עסקית ב־Routes — **כבר לא קורים באף מקום**. גם "אסטרטגיית שגיאות אחת" כבר קיימת ומיושמת.

החוב האמיתי הוא בשלושה מקומות בלבד, ואף אחד מהם אינו "מבנה תיקיות":

1. **אין תשתית בדיקות בכלל** — זה חוסם כל refactor בטוח.
2. **שני קבצי ענק** מרכזים 24% מהקוד (`bankParser.service.ts` + `reconciliation.service.ts`).
3. **חוסר עקביות בשכבות** — חצי מהמודולים עם Controller, חצי בלי. לא באג, אבל עולה זמן בכל תוספת.

**המלצתי המפורשת: לא לעבור למבנה חדש. לחזק את הקיים.** פירוט בהמשך.

---

## 1. מפת הארכיטקטורה הנוכחית

### 1.1 זרימה בפועל

```
HTTP
 ↓
app.ts                    ← CORS · securityHeaders · json(1mb) · rateLimit(login) · 20 route mounts
 ↓
<module>.routes.ts        ← Router + gateAuth + multer + חיווט endpoints
 ↓
gateAuth.middleware       ← Bearer token → req.userId
 ↓
validate.middleware       ← zod parse → req.validated  (זורק ZodError)
 ↓
<module>.controller.ts    ← קיים ב־10/20 מודולים; ב־10 האחרים ה־handler inline ב־routes
 ↓
<module>.service.ts       ← כל הלוגיקה העסקית · ownership check · Prisma
 ↓
<module>.repository.ts    ← קיים ב־8/20 מודולים בלבד (רק היכן שיש query מורכב)
 ↓
Prisma → MariaDB
 ↓
errorMiddleware           ← ApiError | ZodError | PrismaKnownRequestError | 500
```

### 1.2 מפת המודולים והתלויות

20 מודולים תחת `src/modules/`. גרף התלויות החוצה־מודולים:

```
dashboard ──4──> loans          expenses ──> dashboard, categories
updates   ──2──> loans          budgets  ──> dashboard
alerts    ──2──> loans          reports  ──2──> dashboard
bank      ──2──> categories     credit   ──> imports, categories, bank
imports   ──> credit, categories, bank    loans ──> bank
```

**`loans` ו־`dashboard` הם ה־hubs.** `categories/categorization.service` ו־`imports/statementDetector` הם עלים טהורים (לא מייבאים אף מודול) — כלומר הם כבר shared infrastructure בפועל.

### 1.3 מדדים מדודים (לא הערכות)

| מדד | ערך | פסק דין |
|---|---|---|
| `any` / `as any` בכל ה־backend | **0** | מצוין |
| `$queryRaw` / `$executeRaw` | **0** | אין וקטור SQL Injection |
| Prisma מיובא ב־routes או controllers | **0** | SoC נשמר |
| `express` מיובא ב־services | **0** | Services טהורים |
| **מעגלי תלות (file-level)** | **0** | נבדק אלגוריתמית |
| `strict: true` ב־tsconfig | ✅ | |
| קבצי בדיקה (`*.test.ts` / `*.spec.ts`) | **0** | ← החולשה מס' 1 |
| Endpoints עם pagination | **0** | |
| Endpoints עם rate limit | **1** (login בלבד) | |
| קונפיגורציית multer משוכפלת | **4 קבצים** | |
| מיגרציות | 11 | |
| מודלים ב־Prisma | 20 |

---

## 2. נקודות חוזקה — **אל תיגע בזה**

אלה החלטות נכונות שכבר שולמו עליהן. שינוי שלהן = סיכון בלי תמורה.

1. **חלוקה למודולים לפי דומיין.** `bank/ credit/ loans/ family/ dashboard/ imports/` — בדיוק המבנה שביקשת בסעיף "Domain Driven Structure". **הוא כבר קיים.** אין קבצים מפוזרים.

2. **טיפול שגיאות אחיד.** `ApiError` יחיד עם factory methods (`badRequest`/`notFound`/`conflict`...), `errorMiddleware` יחיד, `asyncHandler` שתופס כל async throw. Response shape זהה בכל המערכת: `{ error: { message, details? } }`. ה־frontend קורא אותו במקום אחד (`services/api.ts:43`). **זה בדיוק מה שביקשת ב"Error Handling" — וזה כבר עומד.**

3. **ולידציה כשכבה.** `validate({ body, query, params })` עם zod, התוצאה ב־`req.validated`, וה־ZodError נתפס במידלוור. הערה בקוד מסבירה למה לא מבצעים reassign ל־`req.query` (Express 5). זה קוד שנכתב בידיעה.

4. **אכיפת בעלות עקבית.** דפוס `requireX(userId, id)` לפני כל update/delete (`savings.service.ts:4`). לא סומכים על ה־id מה־URL.

5. **Utils מרוכזים ומשומשים.** `money.utils` (`decimalToNumber`, `sumDecimals`, `round2`), `date.utils` (`monthRange`, `toMonthKey`), `validation.utils` (`idParamSchema`, `resolveMonth` — בשימוש ב־6 מודולים). **0 המרות Decimal מפוזרות** — כלל §5 ב־CLAUDE.md נאכף בפועל.

6. **Single Source of Truth נשמר.** `dashboard.repository` לסכומים חודשיים, `buildCategorizer` לסיווג, ה־read-time merge של expenses+credit לא שוכפל. זה הכלל הכי שביר בפרויקט והוא מוחזק.

7. **קבצי `.check.ts`** (`bankClassification.check.ts`, `loanSchedule.check.ts`) — הם לא "בדיקות אמיתיות", אבל הם מתעדים את כללי הדומיין עם ה־*why* בעברית. **זה נכס. לא למחוק — להמיר.**

---

## 3. נקודות חולשה — מדורגות לפי נזק בפועל

### ✅ W1 — אין תשתית בדיקות · **נפתר ב־2026-08-01 (שלב 0)**

> נשמר כאן לתיעוד המצב שקדם. הפתרון: 169 בדיקות — ראה שלב 0 ב־Roadmap.

<details><summary>המצב שהיה</summary>


`package.json` לא מכיל test runner. `Definition of Done` בסעיף 6 של CLAUDE.md דורש "יש בדיקה/אימות שמכסה את המקרה שטופל" — **הדרישה הזו לא ניתנת לאכיפה כרגע.**

מה שקיים במקומה: שני סקריפטים ידניים שרצים ב־`npx ts-node -T`, ואימות ידני מול קבצי PDF/Excel.

**הנזק:** אין רשת ביטחון לשום refactor. כל שינוי ב־`bankParser` הוא הימור. זו הסיבה שאסור להתחיל מ־W2.

</details>

### 🔴 W2 — שני קבצי ענק

| קובץ | שורות | % מה־backend |
|---|---|---|
| `bank/bankParser.service.ts` | 1,563 | 13.8% |
| `bank/reconciliation.service.ts` | 1,163 | 10.3% |
| **סה"כ** | **2,726** | **24.1%** |

`bankParser.service.ts` מייצא 16 טיפוסים + 6 פונקציות ומכיל בתוכו: מודל הטיפוסים, `classifyBankLine`, `creditCardRefOf`, פרסר Excel (`parseBankStatement`, שורה 980), פרסר PDF (שורה 1507), ופונקציות תיאור בעברית. **חמישה תפקידים בקובץ אחד.**

`reconciliation.service.ts` מכיל 4 טיפוסים + service object עם 10 מתודות, חלקן ארוכות מ־100 שורות (`getReconciliation` ב־452–596, `loanActivityFromStatement` ב־596–712).

**הנזק:** אזור שאסור לגעת בו. כל שינוי דורש קריאה של 1,500 שורות. זה גם המודול הכי פעיל בפרויקט לפי ה־git log.

### 🟠 W3 — חוסר עקביות בשכבת ה־Controller

| יש Controller (10) | אין Controller — handler inline ב־routes (10) |
|---|---|
| alerts, categories, dashboard, expenses, gate, incomes, loans, reminders, settings, updates | **bank**, budgets, **credit**, family, **imports**, paymentMethods, recurring, reports, savings, subscriptions |

הבעיה החריפה ביותר ב־`bank.routes.ts` — 229 שורות, 18 endpoints, כל אחד עם body של 3–6 שורות inline. להשוואה: `loans.routes.ts` הוא 39 שורות ונקרא כטבלת ניתוב.

**הנזק:** אין תשובה לשאלה "איפה שמים קוד חדש". כל מפתח (וכל agent) מחליט מחדש.

### 🟠 W4 — אין Pagination, אין Filters, אין Sorting, אין Metadata

`take:` מופיע **פעמיים בכל ה־backend**, שניהם hardcoded (`alerts.repository.ts:9` → 100, `updates.service.ts:96` → 10).

`GET /api/bank/accounts/:id/transactions` מחזיר **את כל התנועות אי־פעם**. עם 3 שנות דפי חשבון זה אלפי שורות בכל טעינת מסך.

אין מקום ב־response shape להחזיר `total` — כי אין envelope.

### 🟠 W5 — Rate Limiting רק על login

`app.ts:47` מגביל `/api/gate/login` בלבד. **לא מוגבלים:**
- `POST /api/bank/accounts/:id/import` — קובץ עד 10MB, פרסינג PDF/Excel = CPU כבד
- `POST /api/credit/import`, `POST /api/imports/*`, `POST /api/loans/schedule/import`
- `POST /api/bank/reconciliation/auto` — סורק וכותב את כל ה־DB

**הנזק:** לולאה תקועה ב־frontend, או לחיצה כפולה של המשתמשת, יכולה להפיל את השרת. זה לא תרחיש תקיפה — זה תרחיש שימוש.

### 🟡 W6 — הטיפוסים המשותפים לא נמצאים איפה ש־CLAUDE.md אומר

CLAUDE.md §3: *"טיפוסים משותפים במקום אחד: backend ב־`backend/src/types/`"*.

בפועל `backend/src/types/` מכיל **רק שתי הצהרות ambient** (`express.d.ts`, `pdf-parse.d.ts`). כל הטיפוסים העסקיים חיים בתוך `*.validation.ts` (נגזרים מ־zod) ובתוך `*.service.ts`.

במקביל, `frontend/src/types/models.ts` (368 שורות) הוא **מראה ידנית** של אותם טיפוסים. אין שום מנגנון שמונע drift.

**הנזק:** שינוי שדה ב־backend לא מייצר שגיאת קומפילציה ב־frontend. הבאג מתגלה ב־runtime אצל המשתמשת.

### 🟡 W7 — קונפיגורציית העלאה משוכפלת 4 פעמים

בלוק זהה של `multer({ storage: memoryStorage(), limits: { fileSize: 10MB } })` ב־`bank.routes.ts:28`, `credit.routes.ts:16`, `imports.routes.ts:12`, `loans.routes.ts:9`. שינוי מדיניות קבצים = 4 עריכות + סיכוי לפספס אחת.

### 🟡 W8 — אין Logging מובנה ואין Audit

הכל `console.log` / `console.error`. אין request-id, אין רמות, אין קורלציה בין שגיאה לבקשה שגרמה לה. `errorMiddleware:47` מדפיס `console.error("Unhandled error:", err)` — בלי לדעת איזה משתמש, איזה route, איזה body.

אין audit trail על פעולות הרסניות (`reconciliation/auto` משנה רשומות בכל הטבלאות).

### 🟡 W9 — שגיאות בלי קוד מכונה

`{ error: { message: "יעד החיסכון לא נמצא" } }` — ה־frontend יכול רק להציג את המחרוזת. הוא לא יכול להבדיל בין "לא נמצא" ל"אין הרשאה" ל"קובץ פגום" בלי להשוות טקסט עברי.

### 🟡 W10 — `cachedPrimaryUserId` הוא חסם ארכיטקטוני עתידי

`gateAuth.middleware.ts:13` — משתנה גלובלי במודול שמחזיק את ה־user היחיד. כל בקשה מאומתת פועלת כאותו משתמש. יש מודול `family/` — כלומר הכיוון המוצרי הוא ריבוי משתמשים, וזו נקודת השבירה.

**זה לא באג היום.** ה־services כבר מקבלים `userId` כפרמטר ומסננים לפיו — כלומר **90% מהעבודה למולטי־יוזר כבר עשויה**. רק המידלוור צריך להשתנות.

### ⚪ W11 — אין Event Bus / Queue / Scheduler

`scanForAlerts` נקרא סינכרונית מתוך `alerts.service`. אין `setInterval`, אין cron, אין תור. פרסינג PDF של 10MB רץ בתוך ה־request.

**זה לא חוב טכני היום** — זה מגבלה מודעת של אפליקציה חד־משתמשית. אבל זו הפער היחיד שרלוונטי ל"AI Readiness".

---

## 4. תשובות ישירות לשאלות שלך

### 4.1 "האם נכון לעבור למבנה שכבות Route→Controller→Validation→Service→Repository?"

**חלקית. אתה כבר שם — חוץ מהעקביות.**

הזרימה שביקשת קיימת. מה שחסר זה ש**היא לא זהה בכל מודול**. לכפות Controller על כל 20 המודולים = 10 קבצים חדשים ו־~600 שורות pass-through בלי שום שינוי התנהגות.

**ההמלצה שלי — כלל אחד, לא רפורמה:**

> **`*.routes.ts` הוא טבלת ניתוב בלבד.** אם גוף ה־handler עולה על שורה אחת, הוא עובר ל־`*.controller.ts`.

לפי הכלל הזה, רק **5 מודולים** באמת דורשים חילוץ Controller: `bank` (229 שורות!), `credit`, `imports`, `savings`, `reports`. השאר כבר עומדים בו או קרובים.

**התוצאה:** `bank.routes.ts` יורד מ־229 ל־~45 שורות ונקרא כמו `loans.routes.ts`. זו הבהרה, לא מיגרציה.

### 4.2 "Repository Pattern — האם מתאים?"

**התשובה הכנה: חלקית, ואתה כבר מיישם את הגרסה הנכונה בלי לקרוא לה בשם.**

**נגד repository גורף:**
- Prisma **הוא כבר Data Mapper**. `prisma.savingsGoal.findMany({ where: { userId } })` לא צריך עטיפה שכל תוכנה הוא `return prisma.savingsGoal.findMany({ where: { userId } })`.
- 12 repositories חדשים = 12 קבצים, ~400 שורות, אפס לוגיקה. **סרבול טהור.**
- הטיעון הקלאסי ("להחליף DB") לא רלוונטי — לא תחליף MariaDB.

**בעד repository ממוקד — יש כאן סיבה אמיתית ויחידה:**

CLAUDE.md §4 מגדיר **אינוריאנטות שנמצאות בצורת ה־query עצמה**:
- סכומי כסף חודשיים = `expenses` + credit מאושר **לפי `billingDate`**
- הוצאות = **read-time merge** של `expenses` + credit, בלי העתקת נתונים

אם ה־query הזה נכתב פעמיים — יש double-count בדשבורד. **זו לא בעיית ארכיטקטורה, זו בעיית כסף.**

**הכלל שאני ממליץ לכתוב ב־CLAUDE.md:**

> Repository נוצר **אך ורק** כאשר ה־query מקודד כלל דומיין שאסור לשכפל.
> CRUD פשוט על טבלה אחת → Prisma ישירות מה־service.

לפי הכלל הזה, ה־8 repositories הקיימים (`dashboard`, `expenses`, `loans`, `alerts`, `categories`, `incomes`, `reminders`, `gate`) הם בדיוק הנכונים, ו**אין להוסיף ולו אחד**. אתה מקבל את היתרון בלי החיסרון.

### 4.3 "Domain Driven Structure"

**כבר קיים. אל תזיז קבצים.**

המבנה שתיארת (`bank/ credit/ loans/ family/ dashboard/`) הוא בדיוק המבנה בפועל. מה שחסר לעומת הרשימה שלך: `DTO`, `Mapper`, `Tests` בתוך כל דומיין.

- **Tests** — כן, יתווספו (שלב 1).
- **DTO/Mapper** — **לא ממליץ**. ה־zod schemas כבר משמשים כ־DTO (`z.infer` נותן את הטיפוס), ו־Prisma מחזיר אובייקטים שה־frontend צורך ישירות. הוספת Mapper layer תוסיף 20 קבצים כדי לתרגם A ל־A.

**החריג היחיד: `bank/` צריך פיצול פנימי.** 9 קבצים שמערבבים parsing, reconciliation, balance, coverage. זה הדומיין היחיד שגדל מעבר לגודל בריא.

### 4.4 API Design

| היבט | מצב | פסק דין |
|---|---|---|
| **Error shape** | `{ error: { message, details? } }` בכל מקום | ✅ אחיד |
| **Response shape** | payload גולמי (array/object), ללא envelope | ⚠️ עקבי, אבל בלי מקום ל־metadata |
| **Delete responses** | `{ ok: true }` ב־19 מקומות | ✅ עקבי |
| **Naming** | kebab-case ב־URL (`/payment-methods`), camelCase ב־JSON | ✅ עקבי |
| **Pagination / Filters / Sorting** | לא קיימים | 🔴 חסר |
| **Metadata** | לא קיים | 🔴 חסר |

**ההמלצה הלא־אינטואיטיבית: אל תוסיף envelope (`{ data: ... }`).**

זה ישבור כל קריאת API ב־frontend בבת אחת — שינוי עתיר סיכון בלי תמורה ישירה למשתמשת. במקום זה:

- Pagination **רק ב־3 endpoints שבאמת צריכים אותה**, כ־opt-in: `?limit=&offset=` שמחזיר `{ items, total }`. בלי הפרמטרים — התנהגות זהה להיום. **אפס שבירה.**
- הוספת `code` לאובייקט השגיאה — **additive, לא שובר** (מי שלא קורא אותו לא מושפע).

### 4.5 Business Logic — האם יושבת במקום הנכון?

**כן. שלושת הכללים שביקשת נאכפים ב־100%:**

| דרישה | תוצאת בדיקה |
|---|---|
| אין SQL ב־Controllers | ✅ 0 מופעי `$queryRaw`, 0 ייבוא Prisma ב־controllers |
| אין Express ב־Services | ✅ 0 ייבוא `express` בקובץ `*.service.ts` |
| אין Business Logic ב־Routes | ⚠️ כמעט — `bank.routes.ts` מכיל חילוץ פרמטרים inline, אבל **אפס לוגיקה עסקית** |

### 4.6 Shared Infrastructure — מה כדאי לשתף

| מועמד | מצב | המלצה |
|---|---|---|
| **Upload** | משוכפל 4× | ✅ **כן** — `middlewares/upload.middleware.ts`. שינוי מכני, אפס סיכון |
| **Validation** | כבר משותף | ❌ לא צריך |
| **Money/Date utils** | כבר משותפים ובשימוש | ❌ לא לגעת |
| **Categorization** | `categorization.service` כבר עלה טהור שמשמש 4 מודולים | ⚠️ להעביר ל־`shared/` רק אם תעשה refactor רחב. לא דחוף |
| **Logging** | לא קיים | ✅ **כן** — logger דק, שלב 3 |
| **Notifications** | `alerts` + `reminders` + `updates` = 3 מודולים עם חפיפה מושגית | ⚠️ **לבדוק, לא לאחד עכשיו.** איחוד = שינוי התנהגות. מחוץ לתחום |
| **Audit** | לא קיים | ⚠️ רק אם עוברים למולטי־יוזר |
| **Events** | לא קיים | ⏸ ראה 4.7 |

### 4.7 AI Readiness

| יכולת | מוכנות | פער |
|---|---|---|
| **AI Agents** | 🟢 טובה | ה־services טהורים (בלי Express) — agent יכול לקרוא להם ישירות. זה היתרון הכי גדול של הארכיטקטורה הנוכחית |
| **Document Processing** | 🟡 חלקית | הפרסרים קיימים ועובדים, אבל **קבורים בתוך קובץ של 1,563 שורות** ורצים סינכרונית ב־request |
| **Event Bus** | 🔴 אין | |
| **Background Jobs / Scheduler / Queue** | 🔴 אין | פרסינג 10MB חוסם את ה־event loop |

**ההמלצה: לא לבנות Event Bus / Queue עכשיו.** תשתית שאין לה צרכן היא חוב טכני בפני עצמה.

**מה כן לעשות — תפר אחד (seam), זול:** לגרום ל־`bankService.importStatement` להחזיר תיאור מובנה של מה שקרה (כבר יש `BankIngestionReport`!) ולרכז את הקריאות ל־side-effects (`scanForAlerts` וכו') לנקודה **אחת**. ביום שתרצה תור — מחליפים קריאה ישירה בפרסום אירוע, בקובץ אחד.

### 4.8 TypeScript Review

| היבט | ממצא |
|---|---|
| `strict: true` | ✅ |
| `any` מיותרים | ✅ **0 בכל ה־backend.** מצוין |
| Casting מיותר | ⚠️ דפוס `req.validated?.body as CreateLoanBody` חוזר בכל handler. **הקאסט הזה לא מאומת** — אם מישהו ישכח `validate({ body })` ב־route, ה־service יקבל `undefined` בזמן ריצה |
| Interfaces / Types | ✅ עקבי — `interface` לצורות, `type` ל־unions |
| Generics | ⚠️ כמעט לא בשימוש. זה בסדר — אין כאן צורך אמיתי |
| Utility Types | ⚠️ שימוש מועט. `z.infer` ממלא את התפקיד |

**הפער היחיד ששווה תיקון:** `validate()` יכול להיות generic ולהחזיר handler מוקלד, מה שיהפוך את ה־casting למיותר ואת השכחה ל־compile error. **שיפור אמיתי ב־type safety, לא קוסמטיקה.**

### 4.9 Security

| היבט | מצב |
|---|---|
| **SQL Injection** | 🟢 בלתי אפשרי — 0 raw SQL, Prisma בלבד |
| **Validation** | 🟢 zod על body/query/params בכל endpoint מוטב |
| **Authentication** | 🟡 סיסמה משותפת + bearer token. מתאים לאפליקציה משפחתית פרטית |
| **Authorization** | 🟡 `requireX(userId, id)` עקבי — אבל `userId` תמיד אותו אחד (W10) |
| **Rate Limiting** | 🔴 login בלבד. העלאות וסריקות חשופות (W5) |
| **Sensitive Data** | 🟡 `errorMiddleware` חושף `err.message` רק ב־development ✅. אבל אין בקרה על מה שנכנס ל־`console.log` — קובץ בנק מכיל מספרי חשבון |
| **Logging** | 🔴 אין audit על פעולות הרסניות |
| **Security Headers** | 🟢 קיים middleware ייעודי |
| **CORS** | 🟢 allow-list מפורש בפרודקשן, פתוח ב־dev |

### 4.10 Testability

| סוג | היתכנות היום |
|---|---|
| **Unit** | 🟢 **קל מאוד** — פונקציות כמו `classifyBankLine`, `creditCardRefOf`, `loanCalculator`, `money.utils`, `date.utils` הן טהורות. אפשר לבדוק אותן בלי DB ובלי HTTP. **זה נכס ענק שלא מנוצל** |
| **Integration** | 🟡 בינוני — services מייבאים `prisma` ישירות (לא מוזרק). ניתן לבדיקה מול DB אמיתי, לא ניתן ל־mock בקלות. **בפרויקט פיננסי — DB אמיתי עדיף בכל מקרה** |
| **E2E** | 🟢 קל — `app.ts` מייצא את ה־app בנפרד מ־`server.ts`. supertest יעבוד מיידית **בלי שום שינוי קוד** |

**המסקנה החשובה: המבנה כבר מאפשר בדיקות בכל שלוש הרמות. פשוט אין runner.**

---

## 5. Roadmap — Refactoring הדרגתי

עיקרון מנחה: **כל שלב עומד בפני עצמו, מסתיים במערכת עובדת, וניתן לעצירה אחריו.**

---

### ✅ שלב 0 — רשת ביטחון · **הושלם 2026-08-01**

> אין refactor בטוח בלי בדיקות. זה לא שלב אופציונלי.

**מה נבנה בפועל: 169 בדיקות, 7 קבצים, הכל ירוק.**

| רכיב | תוצאה |
|---|---|
| Runner | vitest 4 + supertest · `npm test` · `npm run test:watch` |
| המרת `bankClassification.check.ts` | ✅ → `bankClassification.test.ts` — **26/26 מקרים הועברו, אומת מכנית** |
| Unit — `money.utils`, `date.utils` | ✅ 30 בדיקות |
| Unit — `loanCalculator.service` | ✅ 22 בדיקות, מכוילות מול לוח הסילוקין האמיתי של הלוואה 108/432 |
| Golden — `parseBankStatement` | ✅ Excel חד־חודשי (35 שורות) + רב־חודשי (187 שורות) |
| Golden — `parseBankStatementPdf` | ✅ 53 שורות · מסלול `pdf-columns` **נבדק בנפרד** |
| Golden — `parseLoanSchedule` | ✅ שני מסלולי הלוואה 108 (432 + 562) |
| E2E smoke — supertest | ✅ 20 בדיקות · אתחול האפליקציה, 10 מסלולים מוגנים, צורת השגיאה, חסימת התחברות |
| `typecheck` + `typecheck:test` | ✅ נקי · הבדיקות **לא** נכנסות ל־`dist` |

**ארכיטקטורת הבדיקות — שתי שכבות:**

1. **אינווריאנטות** (נכנסות ל־git, בלי אף מספר מהחשבון) — שחזור היתרה נסגר על היתרה המודפסת; ארבע קטגוריות החובה מכסות את עמודת החובה במלואה; Σקרן = יתרת ההלוואה; כל שורה קיבלה משמעות פיננסית.
2. **Golden snapshot** (`tests/fixtures/golden.json`, git-ignored) — הסכומים המדויקים.

**אבטחת מידע:** `backend/tests/fixtures/` הם דפי חשבון אמיתיים ולכן **git-ignored**. הבדיקות מדלגות בהיעדרם; `npm run test:fixtures` מדווח מה חסר.

**הוכחת יעילות — נבדק בשתי מוטציות מכוונות:**

| מוטציה | נתפסה על ידי |
|---|---|
| עמלת פירעון מוקדם מסווגת כהוצאה שוטפת (הבאג האמיתי מ־`0bf9163`) | **4 בדיקות** — האינווריאנטות נשארו ירוקות (הכסף עבר בין שתי קטגוריות באותו סכום), **ה־golden תפס**. זו בדיוק הסיבה לשתי השכבות |
| שורה אחת נופלת בשקט מהפרסר | **8 בדיקות** — שחזור היתרה, ספירת השורות וה־golden, בשלושת מסלולי הפרסינג |

**מה נמחק:** `bankClassification.check.ts` — הוחלף במלואו. גובה לפני המחיקה; שחזור: `git checkout backend/src/modules/bank/bankClassification.check.ts`.
**מה נשמר:** `loanSchedule.check.ts` — הוא מדפיס ולא בודק, ולכן שימושי לבחינת ייצוא חדש לפני שהוא הופך ל־fixture. הופנה לתיקיית ה־fixtures.

**התוצאה:** `Definition of Done` §6.2 הפך לניתן לאכיפה, ו־CLAUDE.md §6.1 מתעד את הנוהל.

---

### שלב 1 — ניקיונות מכניים · 🟢 אפס סיכון

1. **`middlewares/upload.middleware.ts`** — קונפיג multer אחד, 4 route files מייבאים אותו (W7).
2. **Rate limit על העלאות וסריקות** (W5). ה־middleware כבר קיים — רק להפעיל.
3. **`code` לשגיאות** (W9) — `ApiError` מקבל שדה `code` אופציונלי, ה־factories ממלאים ברירת מחדל (`NOT_FOUND`, `BAD_REQUEST`...), ה־middleware מוסיף ל־JSON. **Additive — ה־frontend ממשיך לעבוד ללא שינוי.**
4. **Logger דק** (`utils/logger.ts`) — רמות + request-id. להחליף את `console.error` ב־`errorMiddleware` בלבד. **לא לרדוף אחרי כל console.log בשלב הזה.**

**סיכון:** נמוך מאוד. שינוי התנהגות היחיד: בקשה 21 בדקה להעלאה תקבל 429 (וזה הכוונה).

---

### שלב 2 — פירוק שני קבצי הענק · 🟠 **דורש את שלב 0** · הערך הגבוה ביותר

**דרישת סף: הבדיקות משלב 0 עוברות ירוק לפני ואחרי כל צעד.**

**2א. `bankParser.service.ts` (1,563 →)** — פיצול לפי אחריות, לתיקייה `bank/parser/`:

| קובץ חדש | תוכן | מקור |
|---|---|---|
| `parser/bankParser.types.ts` | 16 הטיפוסים + `BANK_MONEY_LABELS` | שורות 1–440 |
| `parser/bankClassifier.ts` | `classifyBankLine`, `creditCardRefOf` | 440–510 |
| `parser/bankExcel.parser.ts` | `parseBankStatement` | 980–1507 |
| `parser/bankPdf.parser.ts` | `parseBankStatementPdf` | 1507–1532 |
| `parser/bankReport.ts` | `describeIngestionReport`, `describeMonthlyConditions` | 1532–1563 |
| `bankParser.service.ts` | **re-export בלבד** | — |

**קריטי:** הקובץ המקורי נשאר כ־barrel שמייצא הכל מחדש → **אף import קיים לא משתנה. אפס סיכון לשאר המערכת.**

**2ב. `reconciliation.service.ts` (1,163 →)** — אותו עיקרון: `reconciliation/` עם `types`, `resolver` (`resolveAll`/`backfill`), `view` (`getReconciliation`), `loanActivity`, `links` (`linkIncome`/`linkExpense`/`linkLoan`/`exclude`/`reset`). ה־service object נשאר בשמו ומרכיב את החלקים.

**כלל ברזל לשלב הזה: העברת קוד בלבד. לא לשפר, לא לנקות, לא לשנות שם — cut & paste מדויק.** כל שיפור נעשה בקומיט נפרד, אחרי שהירוק חזר.

---

### שלב 3 — עקביות שכבות · 🟡 סיכון נמוך

1. **לכתוב את הכלל ב־CLAUDE.md** (route = חיווט; handler ארוך משורה → controller). **הכלל לפני הקוד.**
2. לחלץ Controller ב־5 המודולים החורגים: **`bank` (הכי דחוף — 229 שורות)**, `credit`, `imports`, `savings`, `reports`.
3. **לכתוב ב־CLAUDE.md את כלל ה־Repository מסעיף 4.2** ולא להוסיף repositories.
4. **`validate()` generic** (סעיף 4.8) — מבטל את ה־casting הלא־מאומת בכל handler.

**סיכון:** העברת קוד בין קבצים באותו מודול. הבדיקות מ־0 מכסות.

---

### שלב 4 — חוזה API · 🟡 נוגע ב־frontend

1. **Pagination opt-in** ב־3 endpoints: `bank/accounts/:id/transactions`, `expenses`, `credit transactions`.
   `?limit&offset` → `{ items, total }`; **בלי פרמטרים — התנהגות זהה להיום**. אחר כך ה־frontend מאמץ מסך־מסך, בקצב שלו.
2. **טיפוסים משותפים** (W6) — הכיוון הזול: `backend/src/types/api.ts` שמייצא את ה־`z.infer` הציבוריים, ו־`frontend/src/types/models.ts` מייבא ממנו דרך path alias. **בלי monorepo, בלי build step.**

---

### שלב 5 — נדחה עד שיהיה צורך אמיתי · ⏸

- **Event Bus / Queue / Scheduler** — רק כשיהיה agent או job שדורש אותם. עד אז: לרכז side-effects לנקודה אחת (4.7).
- **Multi-user** (W10) — רק בהחלטה מוצרית. **דורש migration ל־DB** (ownership אמיתי, הרשאות, audit).
- **איחוד alerts/reminders/updates** — משנה התנהגות. מחוץ לתחום המשימה הזו.

---

## 6. סיווג לפי סיכון

### ✅ בטוח לחלוטין (אפס שינוי התנהגות)
- כל שלב 0 (בדיקות — קבצים חדשים בלבד)
- `upload.middleware` משותף
- פירוק קבצי הענק **עם barrel re-export**
- `code` לשגיאות (additive)
- Logger ב־`errorMiddleware`
- חילוץ Controllers
- `validate()` generic

### ⚠️ דורש תשומת לב (שינוי התנהגות מכוון ומוגבל)
- Rate limit על העלאות → 429 בשימוש חריג
- Pagination → רק בקריאות עם הפרמטרים החדשים
- טיפוסים משותפים → עלול לחשוף drift **קיים** בין ה־frontend ל־backend (זו התועלת, אבל תתכן עבודת תיקון)

### 🔴 דורש DB Migration — **לא בתחום המשימה הזו**
- Multi-user / ownership אמיתי
- טבלת Audit
- Outbox לאירועים

### 🚫 אל תיגע
- מבנה התיקיות לפי דומיין — **כבר נכון**
- `ApiError` + `errorMiddleware` — **כבר נכון**
- `dashboard.repository` וכללי ה־Single Source of Truth — **הכי שביר בפרויקט**
- `money.utils` / `date.utils`
- לוגיקת הפרסינג עצמה — **להעביר, לא לשפר**
- הוספת envelope ל־responses — **סיכון בלי תמורה**
- Mappers / DTO layer — **סרבול**
- 12 repositories נוספים — **סרבול**

---

## 7. סדר עדיפויות מרוכז

| # | פעולה | ערך | סיכון | תלוי ב־ |
|---|---|---|---|---|
| ~~1~~ | ~~Vitest + המרת `.check.ts` + golden file~~ · **✅ בוצע** | 🔥🔥🔥 | אפס | — |
| 2 | פירוק `bankParser` + `reconciliation` (barrel) | 🔥🔥🔥 | נמוך | 1 |
| 3 | Rate limit על העלאות | 🔥🔥 | נמוך | — |
| 4 | `upload.middleware` משותף | 🔥 | אפס | — |
| 5 | `code` לשגיאות | 🔥🔥 | אפס | — |
| 6 | כלל שכבות ב־CLAUDE.md + חילוץ 5 Controllers | 🔥🔥 | נמוך | 1 |
| 7 | `validate()` generic | 🔥🔥 | נמוך | 6 |
| 8 | Logger + request-id | 🔥 | נמוך | — |
| 9 | Pagination ב־3 endpoints | 🔥 | בינוני | 1 |
| 10 | טיפוסים משותפים backend↔frontend | 🔥 | בינוני | — |
| — | Event Bus / Queue / Multi-user | ⏸ | גבוה | החלטה מוצרית |

**אם יש זמן לצעד אחד בלבד: מס' 1.** בלעדיו כל השאר הוא הימור.

---

## 8. עדכונים מומלצים ל־CLAUDE.md

הביקורת חשפה שני מקומות שבהם החוקה לא תואמת את המציאות:

1. **§3** אומר שטיפוסים משותפים ב־`backend/src/types/` — בפועל הם ב־`*.validation.ts`. או לתקן את הקוד (שלב 4), או לתקן את הכלל.
2. **§6.2** דורש בדיקה לכל משימה — לא ניתן לאכיפה עד שלב 0.

ושלושה כללים חדשים שכדאי להוסיף אחרי הביצוע:
- כלל ה־Repository (4.2)
- כלל ה־Route/Controller (4.1)
- "פירוק קובץ = העברת קוד בלבד; שיפורים בקומיט נפרד"

---

### Handoff
- **מה שונה:** שום קוד. מסמך ביקורת בלבד.
- **קבצים שנגעתי בהם:** `docs/architecture-review.md` (חדש).
- **מה נבדק (ואיך אומת):** מיפוי מלא של `backend/src` — 118 קבצים, ספירת שורות, גרף תלויות חוצה־מודולים, בדיקת מעגלי תלות אלגוריתמית (0 נמצאו), ספירת `any`/raw-SQL/express-in-services (0/0/0), מיפוי שכבות לכל 20 המודולים, קריאת `app.ts`/`error.middleware`/`ApiError`/`validation.middleware`/`asyncHandler`/`gateAuth`/`bank.routes`/`loans.controller`/`savings.service`, בדיקת `package.json`/`tsconfig`, וצריכת החוזה בצד ה־frontend.
- **מה נשאר פתוח / סיכונים:** לא בוצע refactor. הערכת עומק הבדיקות הנדרשות ב־שלב 0 תתחדד רק אחרי כתיבת ה־golden file הראשון מול קובץ Excel אמיתי.
- **מעביר ל:** BOSS — לאישור סדר העדיפויות ולהחלטה מאיזה שלב מתחילים.
