# AGENTS.md — The Money Jungle (handoff for Codex)

Written 2026-09-26 at commit `d485c43`; state re-verified against the code on 2026-09-26.
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

Last known full results: backend 434 tests / 42 files green; Playwright suites green (see `docs/research/household-assistant-implementation.md` §Validation).

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
- Last completed work (2026-09-23): **Household assistant** at `/assistant` (הגדרות וניהול → העוזר המשפחתי) — duplicate-candidate review with audited decisions and undo, evidence-keyed `duplicate_transaction` alerts that are withdrawn (`withdrawn_at`) instead of deleted, optional AI step planning. Full contract: `docs/research/household-assistant-implementation.md`.
- Before that: 6-phase product/UX plan + P0 remediation (G1/G2/G3/G8) — `docs/money-jungle-implementation-progress.md`. Visual redesign — `docs/design/money-jungle-visual-redesign.md`. Roadmap — `docs/roadmap-next-phase.md`.

## 6. Open items / known issues

1. **Cal credit import — fixed in code, not yet re-verified by a real import.** Cal statements hold a triple per purchase (immediate charge חיוב מיידי + reversal + regular billing). The old dedup collapsed the two positive legs inside one file, so a purchase netted to zero (₪21,189 → ₪14,549). Since 2026-09-18 (`25d5597`, `256b7ce`) dedup is a multiset against rows **already in the DB** only (`credit.service.ts` `remaining` map; `imports/importRows.service.ts` "one existing occurrence suggests one duplicate"), so repeated rows inside one file stay distinct. Verified read-only on 2026-09-26: `parseCreditFile` on the real `פירוט עסקאות וזיכויים.xlsx` → 442 rows, net ₪21,189.16, non-financing ₪20,683.00 (= the last correct import). Still to do: import it through the app into the DB and confirm the stored total matches.
2. **Loan 108 conditional interest.** Loan 108 has two tracks: 432 (fixed interest) and 562 "הריבית עלינו" (interest waived while a ~₪7,000 salary lands). Never derive "condition met" from the presence of an interest credit — that hypothesis was disproven.
3. **Single-source-of-truth violation:** `backend/src/modules/journey/metrics.service.ts` (lines ~30 and ~52) re-declares the confirmed/non-financing credit filter instead of consuming it from `dashboard.repository.ts`.
4. **Dead code (verified: no importer / no client):**
   - `backend/src/modules/imports/smartImport.service.ts` — `smartImportService` is never imported; `/imports/smart` now goes through `legacyImportAdapter.stageLegacyImport`.
   - `frontend/src/components/dashboard/AttentionPanel.tsx` and `getAttention` in `frontend/src/services/dashboard.service.ts` — unused, so `GET /api/dashboard/attention` and `buildAttention` have no client. **Keep** `collectAttentionCandidates`/`mergeAttention` — `journey/actions.service.ts` uses them.
   - `frontend/src/components/dashboard/UpdatesTicker.tsx` and `frontend/src/services/updates.service.ts` — the ticker is not rendered anywhere, so `backend/src/modules/updates/` (`/api/updates/ticker`) has no client. The roadmap's "fifth unmerged attention source" is therefore moot — nothing to merge, only to delete.
   - `smartImportFile`/`importExpensesFile` in `frontend/src/services/finance.service.ts` — compatibility exports with no caller.
5. Other P1/P2 not yet done: server-side pagination for ordinary transaction tables; frontend lint warnings (~22); multi-account funding-allocation model.
6. Roadmap (`docs/roadmap-next-phase.md`) items still open: 2.1 AI orchestrator (provider + bounded planning exist; no tool-calling / free-form Q&A), 2.4 command palette, 3.3 general goals, 4.2 audit/activity log, 4.3 mobile components (bottom sheet, context menu, FAB, nested breadcrumbs), 4.4 chat with a document. 4.1 health/status is mostly covered by the coverage panel. Deferred by explicit decision: `unused_subscription` alert, OCR.
7. Household assistant follow-ups: live AI provider not verified (no key locally); `Income` has no source/provenance column; duplicate matching is exact-only; periodic-expense planning and variable-income scenarios not built.
8. **No real data in the DB**, and the available bank files end 2026-08-01 — August/September statements are needed for a current picture.

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
