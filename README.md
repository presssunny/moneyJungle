<<<<<<< HEAD
# 💸 Cashtastrophe

A simple, family-friendly budget tracker. See where the money goes, who spent it, and how much is left — without spreadsheets or headaches.

## Features

- 📊 Track income and expenses by category
- 👨‍👩‍👧‍👦 Multiple family members, one shared budget
- 📅 Monthly overview with spending breakdown
- 🎯 Set budget goals and see progress at a glance
- 🌐 Full Hebrew (RTL) support

## Getting Started

```bash
# Clone the repo
git clone https://github.com/<your-username>/cashtastrophe.git
cd cashtastrophe

# Install dependencies
npm install

# Run locally
npm run dev
```

Open `http://localhost:3000` in your browser.

## Tech Stack

- Frontend: React
- Styling: Tailwind CSS
- Data: Local storage (cloud sync planned)

## Roadmap

- [ ] Recurring expenses
- [ ] Charts and monthly reports
- [ ] Export to CSV

## License

MIT — free to use, copy, and adapt.

---

*Built with ❤️ for one family tired of asking "who took the change?"*
=======
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

- `backend/.env` — קיים. חובה לשנות את `APP_GATE_PASSWORD` (סיסמת הכניסה לאפליקציה).
- `frontend/.env` — קיים (`VITE_API_URL`).

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
>>>>>>> f515797 (Initial commit)
