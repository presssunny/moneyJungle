# AGENTS.md — The Money Jungle (handoff for Codex)

Written 2026-09-26; updated after the plan completion batch (through commit `1c55be9`).
Read this first, then `CLAUDE.md` (the project constitution, in Hebrew) — its rules are binding for you too.

## 1. What the app is

A personal household-finance app for one Israeli household. Data enters **only** by uploading files (bank statements XLSX/PDF, credit-card statements XLSX, loan amortization schedules XLSX). **Never add Open Banking / direct bank connections — product decision, permanent.**

| Layer | Stack | Port |
| --- | --- | --- |
| Frontend | React 18 + Vite + TypeScript, RTL Hebrew UI, 8 themes | 5173 |
| Backend | Express 5 + Prisma 7 + TypeScript | 3000 |
| DB | MariaDB (`bash backend/start-db.sh`) | 3307 |
| AI | `@anthropic-ai/sdk`, server-side only (`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`); no key configured locally | — |

Backend code: `backend/src/modules/<domain>/` (`bank`, `credit`, `loans`, `expenses`, `incomes`, `dashboard`, `journey`, `imports`, `alerts`, `householdAssistant`, …).
Shared types: `backend/src/types/` and `frontend/src/types/models.ts`.

## 2. Rules you must follow

- **User-facing replies/UI text in Hebrew; code, identifiers, commits in English.**
- TypeScript strict, **no `any`** (use `unknown` + narrowing).
- **Single source of truth — never duplicate a financial calculation:**
  - Monthly money totals → `backend/src/modules/dashboard/dashboard.repository.ts` (`monthTotals`). Everything else consumes it.
  - Categorization → `buildCategorizer`, now in `backend/src/modules/imports/imports.service.ts` (CLAUDE.md still says `credit.service` — outdated).
  - "Expenses" is a **read-time merge** of `expenses` + confirmed credit (`expenses.repository.findCreditByMonth`). Never copy rows between tables — it double-counts on the dashboard.
  - Bank-row meaning → `resolveAll()` in `backend/src/modules/bank/reconciliation.service.ts`. A bank row with `resolution = null` is a bug.
- **Financial domain rules:**
  - Income vs. expense is decided by the physical column (זכות = credit/income, חובה = debit/expense), **not** by description text.
  - `transactionType: "financing"` (revolving credit) is excluded from all spending totals.
  - Loan repayments split into principal (debt reduction, not an expense) and interest (financing expense). Interest credits are negative financing expense, never income.
  - Confirmed credit is attributed to a month by `billingDate`, not `transactionDate`.
  - Prisma `Decimal` arrives in the frontend as a **string**.
  - **Never use `\b` in Hebrew regex** (ASCII-only in JS). Use the `ISSUER_EDGE`/`ISSUER_TAIL` pattern in `bankParser.service.ts`.
  - Loan schedule (לוח סילוקין) is the source of truth for loan terms; the statement is the source for actual events.
- Comments explain *why*, not *what*; max 4 lines per block; no history in comments.
- No DB schema change without a Prisma migration in `backend/prisma/migrations/`. Never edit an applied migration.
- Dashboard shows plain נכנס / יצא / נשאר first, above derived metrics — user's explicit request.

## 3. Definition of Done

1. `frontend`: `npm run build` passes.
2. `backend`: `npm run typecheck` and `npm run typecheck:test` pass; `npm run lint` clean.
3. `backend`: `npm test` (vitest) green **and a new test that fails before the fix and passes after**.
4. `backend`: `npm run test:fixtures` shows all fixtures present. Fixtures in `backend/tests/fixtures/` are **real bank statements, git-ignored**; without them parser tests silently skip, so a green run on a machine without them proves nothing.
5. No regression on other screens.

Never run `npm run test:golden:record` to "fix" a red test — it overwrites the verified golden amounts. Only after a number change was intentionally verified against the bank.

Last known full results (2026-09-26): backend 480 tests / 49 files green; main Playwright run 64 passed (mocked journey + real-data design and onboarding suites, desktop + mobile); assistant real-API suite 12 passed; frontend build and lint (0 warnings) clean; 29 migrations applied, no schema drift; all fixtures present.

## 4. Running locally (WSL on /mnt/c — gotchas)

```sh
bash backend/start-db.sh
cd backend && npm run dev          # port 3000
cd frontend && npm run dev         # port 5173
```

- Vite does **not** hot-reload under WSL. After frontend changes: `pkill -9 -f "[n]ode.*vite"` and restart.
- ts-node-dev leaves stale processes on 3000 (mystery 404s). Before restart: `pkill -9 -f ts-node-dev; pkill -9 -f "[s]rc/server.ts"; fuser -k 3000/tcp`. (Use the `[s]` bracket trick, otherwise pkill kills your own shell.)
- Start long-running servers with `setsid nohup … &` so they survive the calling shell.
- Login is DB-backed, **email + password** (`admin@moneyjungle.local`, user id 1). The `APP_GATE_PASSWORD` in `.env` is no longer used. Ask the user for the password — it is not in the repo.
- curl against `/api` needs `Origin: http://localhost:5173` and, for non-gate routes, the `X-CSRF-Token` returned by login.
- Before reporting a parser bug, confirm the server is actually running the current code.

## 5. Current state

- **DB is intentionally empty** for user 1 — the user wiped all financial data on 2026-09-19 to re-upload from scratch. Not a bug. Backup: `~/finance-db/backups/finance_planner-before-reset-20260919-225301.sql`.
- Source files for re-import are in `/mnt/c/Users/sunny/Downloads/` (`report__2026-01-01__2026-07-24.xlsx`, `report__2026-07-01__2026-08-01.xlsx`, `פירוט עסקאות וזיכויים*.xlsx`, `FibiSave1785065794047.xls`).
- Last completed work (2026-09-26): the remaining roadmap items and audit P1/P2 — activity log, general goals, question answering (household + per document), command palette, mobile sheets/menus/FAB/breadcrumbs, server-side ledger pagination, `Income.source`, multi-account funding allocation, dead-code removal and single-source-of-truth consolidation (`spendingCredit`, `monthTotals.balance`). Commits and scope: `docs/money-jungle-implementation-progress.md` § "Plan completion batch"; status per item: `docs/roadmap-next-phase.md`.
- Earlier: household assistant with duplicate review (`docs/research/household-assistant-implementation.md`), 6-phase product/UX plan + P0 remediation, visual redesign.

## 6. Open items / known issues

1. **Cal statements (resolved 2026-09-26).** Dates were a day early (the credit parser had its own Excel date decoder); both parsers now share `utils/sheetDates.parseCellDate`. Monthly attribution is by purchase date, stored in `billingDate` (historical name) — CLAUDE.md §5 now says so; `chargeDate` is cash flow only. Payment count and installment number are read from Cal's note; `installment_number` keeps 4/12 apart from 3/12. Golden `credit/cal` reconciles to Cal's printed sheet total. Remaining: rows noted "עסקה ב-N תשלומים" carry no index — check two consecutive statements before trusting them.
2. **No "cash" paying account.** With several bank accounts, an obligation paid in cash stays unassigned and blocks the daily allowance (banker-approved for now).
3. **AI provider not configured.** Free-form question routing via the model and the step planner are tested only with injected providers; set `ANTHROPIC_API_KEY` to verify live.
4. **No real data in the DB** (wiped 2026-09-19). Cal credit import is fixed in code (multiset dedup since 2026-09-18; parser on the real file: 442 rows, net ₪21,189.16, non-financing ₪20,683.00) but not yet re-verified by an import. Bank files available end 2026-08-01.
5. **Loan 108 conditional interest.** Track 562 "הריבית עלינו": never derive "condition met" from an interest credit; there is no `interestType` field, so answers word schedule interest as planned only.
6. Deferred by the user: OCR, `unused_subscription` alert. Gated until v1 is validated on real data: periodic-expense planning, variable-income scenarios, fuzzy duplicate matching.
7. Minor: a negative balance in another account that has no charges creates no transfer and no warning (banker: warning optional).

## 7. Where to look

| Topic | File |
| --- | --- |
| Project rules | `CLAUDE.md` |
| Agent role definitions (reference for review roles: banker, qa, architect…) | `.claude/agents/*.md` |
| API/journey contracts | `docs/money-journey-contracts.md` |
| Architecture | `docs/architecture-review.md`, `docs/production-architecture-review.md` |
| Deployment | `docs/production-deployment.md`, `deploy/` |
| Forecast / wallet | `docs/forecast-and-wallet.md` |
| Money invariants check | `cd backend && npx ts-node -T src/database/verifyMoney.script.ts` |
| Re-resolve bank rows | `cd backend && npx ts-node -T src/database/resolveBank.script.ts` |

## 8. When you finish a task, end with

```
### Handoff
- What changed:
- Files touched:
- What was tested (and how verified):
- Open items / risks:
- Hand to:
```
