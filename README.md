# Monthly Finance Planner (CYBER_BUDGET) 💰

אפליקציית Fullstack לניהול ותכנון חודשי של הוצאות והכנסות למשפחה.
עברית מלאה · RTL · עיצוב כהה בסגנון סייבר עם 3 ערכות נושא.

## Stack

| שכבה | טכנולוגיה |
|---|---|
| Frontend | React 18 + TypeScript + Vite, React Router v6, Recharts, Axios |
| Backend | Node.js + Express + TypeScript, zod, Prisma 7 |
| Database | MySQL / MariaDB (utf8mb4) |

## מבנה

```
TheMoneyJungle/
├── frontend/   # React (פורט 5173)
├── backend/    # Express API (פורט 3000)
└── README.md
```

## הקמה — פעם אחת

### 1. מסד הנתונים

הפרויקט משתמש במופע MariaDB מקומי ברשות המשתמש (פורט **3307**, בלי sudo).
המופע כבר אותחל ב־`~/finance-db`. להפעלה אחרי ריסטארט:

```bash
bash backend/start-db.sh
```

> רוצה לעבור ל־MariaDB המערכתי (3306)? צור DB ומשתמש עם `sudo mysql`
> ועדכן את `DATABASE_URL` ב־`backend/.env`.

### 2. קובצי סביבה

קובצי ה־`.env` אינם בגיט. יש ליצור אותם מהתבניות:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

ואז ב־`backend/.env`:

- `DATABASE_URL` — שם המשתמש והסיסמה של ה־DB המקומי (גם `start-db.sh` קורא אותם מכאן).
- `APP_GATE_USERNAME` / `APP_GATE_PASSWORD` — פרטי הכניסה לאפליקציה. **חובה לשנות.**
- `ANTHROPIC_API_KEY` — אופציונלי; בלעדיו האפליקציה עולה, והשגיאה מופיעה רק בקריאת AI בפועל.

### 3. התקנה, מיגרציות ו־seed

```bash
cd backend
npm install
npm run prisma:migrate   # יוצר את הטבלאות
npm run seed             # קטגוריות, אמצעי תשלום וחוקי סיווג ברירת מחדל

cd ../frontend
npm install
```

## הרצה יומיומית

```bash
# טרמינל 1 — Backend
cd backend && npm run dev      # http://localhost:3000

# טרמינל 2 — Frontend
cd frontend && npm run dev     # http://localhost:5173
```

בדיקת תקינות ה־API: `curl http://localhost:3000/api/health`

## סקריפטים (backend)

| פקודה | תיאור |
|---|---|
| `npm run dev` | הרצת פיתוח עם reload |
| `npm run build` | קומפילציה ל־dist |
| `npm run prisma:migrate` | יצירת/הרצת מיגרציות |
| `npm run seed` | זריעת נתוני ברירת מחדל |
| `npm test` | כל הבדיקות (vitest) |
| `npm run test:watch` | בדיקות במצב watch |
| `npm run typecheck` / `typecheck:test` | בדיקת טיפוסים לקוד המוצר / לקוד הבדיקות |
| `npm run lint` | oxlint (גם ב־frontend) |
| `npm run test:fixtures` | אילו קובצי בדיקה אמיתיים קיימים |
| `npm run test:golden:record` | ⚠️ רישום מחדש של ה־golden — רק בשינוי מכוון ומאומת |

בדיקות הפרסרים רצות מול **דפי חשבון אמיתיים** שאינם ב־git (`backend/tests/fixtures/`,
ראה ה־README שם). בלעדיהם הן מדלגות — ריצה ירוקה בלי fixtures אינה מוכיחה שהפרסרים עובדים.

## אבטחה והיקף

הפרויקט נבנה כאפליקציה **מקומית וחד־משתמשית** למשפחה אחת, וזה מה שקובע את מודל האבטחה:

- **כניסה** — שם משתמש וסיסמה יחידים מ־`backend/.env`, מושווים ב־`crypto.timingSafeEqual`.
  אין טבלת משתמשים ולכן אין סיסמאות שמורות ל־hash. כל האימות יושב ב־`modules/gate/credentials.ts`,
  כך שמעבר ל־JWT / OAuth / ריבוי משתמשים הוא שינוי בקובץ אחד.
- **סשן** — טוקן של 32 בתים אקראיים; ב־DB נשמר רק ה־SHA-256 שלו, עם תפוגה שנאכפת בשרת.
- **הרשאות** — כל מסלול ה־API מאחורי `gateAuth` פרט ל־login, ובדיקה בסוויטה מוודאת זאת לכל מודול.
- **קלט** — ולידציית zod על כל גוף/פרמטר; גישה ל־DB דרך Prisma בלבד, בלי SQL גולמי.
- **קבצים** — העלאות מוגבלות ל־10MB ונקראות מהזיכרון; שם הקובץ של המשתמש לא נכתב לדיסק.
- **לוגים** — קליטת דוח בנק מדפיסה שורות מהדוח (תיאור וסכומים) כדי שיהיה ברור מה נקלט ומה נדחה.
  זה מכוון, אבל **אין לשלוח את הלוגים האלה לשירות לוגים משותף**.

מה שלא נעשה, במכוון: אין חיבור Open Banking ואין משיכת נתונים אוטומטית מהבנק —
רכישת הנתונים היא ידנית (העלאת קבצים) ותישאר כזו.
