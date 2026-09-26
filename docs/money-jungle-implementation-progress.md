# Money Jungle implementation progress

Work plan: `money-jungle-product-ux-implementation-plan.md` (17 September 2026).
Started 18 September 2026 from clean HEAD `7dd2e1b`. Existing implementations and data are retained.

## Phase 1 — correctness

- Financial HTTP operations and journey validation share the per-user transaction lock. Responses are sent only after commit; nested callback and array transactions roll back together. Download streams remain outside the transaction wrapper.
- Financial mutations advance a persisted revision. Coverage also fingerprints domain data, invalidates on edits/deletes, and records separate account/card acknowledgements with source revisions. Observed transaction ranges are explicitly distinguished from unverified statement periods.
- Decisions retain their evidence and change history. Acknowledged overdue debt survives advancement/removal of its schedule. Linked payments and total duplicate allocations are revalidated on reads.
- Nonfinancial reminders without amounts do not block cash planning. Financial reminders with unknown amounts do. Partial bank payments cannot mark a larger obligation settled. Unmatched financing and funding across multiple accounts remain unavailable, with an explanation.
- Manual balance corrections win over a statement on the same date. Future/invalid anchor dates are rejected. Business-day helpers use Israel dates and UTC date arithmetic; date-only display does not drift with browser timezone.
- Browser validation exposed pre-existing navigation races: filters no longer write the URL on mount, and the onboarding guard reloads server progress on entering Home. The Quick Add date assertion accepts the locale's date separator.
- Migration `20260918140000_financial_revision` applied locally after checking migration status; no existing migration was edited.

Validation: backend full suite 24 files / 313 tests passed; frontend desktop/mobile 8 E2E tests passed; frontend production build and backend application/test typechecks passed. All six real report fixtures and golden files were present. The final targeted rerun passed 49 tests across five files. Commit: `458f21a`.

## Phase 2 — Home

Home now obtains one consistent status/actions/upcoming response. A shared server ranker groups by source/topic, retains distinct issues sharing a URL, includes coverage blockers and unresolved overdue debt, and returns at most three actions. The full queue remains accessible. Coverage/date and a first-activity state sit next to the primary picture; analysis stays lazy. Session and credit-review actions share their source topic. Savings actions select unfinished goals by deadline/target rather than insertion order.

Validation: 17 targeted backend tests passed, including same-topic/different-route and different-topic/same-route cases, plus overdue Home integration; eight desktop/mobile browser tests passed; backend application/test typechecks and frontend build passed.

## Phase 3 — staged imports and review

Uploads persist before parsing and failed processing can resume from stored bytes. Parser version, paginated rows, original/normalized values, candidate matches, decisions and exact output references are stored. Expense/credit rows support controlled date/description/amount correction; bank/schedule monetary values remain tied to the verified source file, with replacement-file correction and per-row duplicate review. Matching is occurrence-aware and requires explicit confirmation; changes in existing source rows invalidate the preview before commit.

All legacy HTTP upload routes now return HTTP 202 with a durable session/review URL and write no money until commit. Required provenance participates in the import transaction. Completion verifies the source still exists; rollback/direct credit deletion updates sessions. Retried commits return the stored result before accessing bytes and validate the request version. Document deletion protects session provenance and shared files; unreferenced bytes are removed only after commit. Bank review links focus the selected row and review screens provide a return link.

Validation: staged import integration covers expense edits/lineage, duplicate decisions, stale/concurrent edits, parse failure/retry, required-provenance rollback, legacy staging, and real bank XLSX/PDF, credit and loan-schedule files. Existing document rollback, journey, API smoke and wallet suites were exercised. Application/test typechecks and frontend build passed. All ten browser cases passed across the full run and the focused mobile/desktop row-edit rerun (the initial mobile assertion was corrected for table labels).

## Phase 4 — weekly check-in

Snapshots use schema version 2 and a calculation version, with at most 1,000 detailed rows in three calendar months and a digest/count for older data. Comparison reads ledger fields in batches of 500, preserves partial-coverage limitations, does not count aging-out as deletion, and avoids exact change counts when detail is truncated. Legacy snapshots start a new baseline. The same ranked action as Home is saved with its reason; upcoming items include overdue debt. Step advancement and idempotent completion share the financial transaction boundary.

Validation: 19 backend tests across snapshot comparison, journey integration and action ranking passed; desktop/mobile check-in resume-to-completion tests passed; backend typechecks and frontend production build passed.

## Phase 5 — explainability and transaction UX

A typed metric endpoint returns value, period/as-of, coverage, missing inputs, assumptions, formula/calculation version, source links and paginated components from one financial transaction. Cash, daily allowance (including the limiting day and all reserves), commitments, monthly income/expense/surplus and next card charge are covered. Monthly totals reuse the dashboard source of truth; a later page rejects changed data. The Home summary carries the same version contract. Metric detail loads only on expansion. Existing loan schedule and forecast detail remain in use; health-score components, budget pace and savings limitations are now explicit.

Transaction tables precede analysis. Search, category/type, uncategorized, recurring and date filters live in the URL; back and refresh retain them. Filtered counts/sums are distinct from monthly totals. Analysis is lazy, shared monthly reads coalesce duplicate requests, mutation invalidation refreshes relevant table domains, and Quick Add no longer remounts the active table. Previous quick additions retain links to their records. Mobile validation exposed overflowing filter fields; their flex basis now prevents overlapping controls.

Validation: 44 backend tests passed across metric reconciliation/version/ownership, allowance, wallet and API smoke suites. All 16 browser cases passed across the full run and four-case focused rerun after fixing duplicate development-mode reads and mobile filter overlap. Backend application/test typechecks and frontend production build passed.

## Phase 6 — branding, compatibility and cleanup

Login and sidebar consume the shared `PRODUCT_NAME` directly; the obsolete theme-brand wrapper and old product name were removed. All eight saved theme IDs are retained. Legacy standalone/bookmark routes redirect to the canonical hubs while retaining query/hash/navigation state. The four management groups remain available, and review links now provide an allowed return destination. Source links target the actual credit import parameter and document archive.

Journey contracts now live in a type module. Unused direct-upload client helpers delegate to the durable session flow with accurate response types. Domain-scoped refresh covers account overview, wallet, documents, settings, lookup data and CRM; theme changes do not trigger money queries. Transaction tabs and income analysis are lazy. Refresh/error states label old data without discarding active form components. Contracts, source boundaries and operational limitations are documented in `money-journey-contracts.md`.

The final schema comparison found two missing `@default(now())` declarations for timestamps whose defaults were already present in the applied migrations. The schema now matches the database, without editing applied migrations or changing stored data.

Phase validation: 22 desktop/mobile browser tests passed, including all eight themes on login/navigation, persisted choices, lazy detail, transaction history and legacy query preservation. Frontend production build passed. Backend final validation is recorded below after the phase commit.

## Final validation

Release validation completed on 19 September 2026 with dependencies restored to the existing lockfile:

| Check | Result |
| --- | --- |
| Backend `npm test` | **28 files / 337 tests passed**, no skipped tests (113.41 s) |
| Frontend Playwright | **22 tests passed**, desktop + Pixel 7/mobile; all eight themes covered (1.2 min) |
| Frontend `npm run build` | Passed |
| Backend build | Prisma generation plus TypeScript compilation passed; Prisma cache access used the existing approved command |
| Backend application/test typechecks | Passed |
| Backend lint | Passed, no warnings |
| Frontend lint | Exit 0; non-blocking React purity/effect/Fast Refresh warnings remain |
| Real fixtures | All six source files present; all five applicable golden entries present |
| Prisma migration status | All 19 migrations applied locally |
| Prisma schema diff | No difference detected, exit 0 |
| Diff whitespace | `git diff --check` passed |

A preliminary test run overlapped dependency repair; another overlapping run produced a database deadlock. The isolated failing case passed, and the final full run above was executed alone. The dependency repair restored the original lockfile versions and did not change the lockfile. These preliminary failed runs are not counted as release validation. Source data/fixtures and existing work were preserved.

## Phase commits

| Phase | Commit | Scope |
| --- | --- | --- |
| 1 | `458f21a` | Financial transaction/coverage/decision correctness |
| 2 | `5c4a75f` | Consistent Home state and ranked actions |
| 3 | `256b7ce` | Durable imports, editable rows, lineage and rollback |
| 4 | `9d1c713` | Bounded weekly snapshots and shared next action |
| 5 | `2377975` | Metric source detail and persistent transaction filters |
| 6 | `483f0d8` | Branding, canonical routes, scoped refresh and contracts |

## Explicit operating limits

- Daily allowance remains unavailable with missing/stale coverage, unmatched financing, unknown unpaid obligations or several accounts without funding allocation. This is the intended guard from the plan, not a guessed positive amount.
- Statement transaction ranges do not establish complete coverage; bank/schedule monetary corrections require a corrected source file.
- Ordinary monthly transaction tables still use the existing monthly APIs and client pagination. Import/metric detail is server paginated; whole-ledger version fingerprinting remains an optimization candidate for larger datasets.
- Browser tests use mock HTTP. Real-file parsing, source ownership and transaction behavior are covered separately by backend integration tests.

## P0 remediation batch (2026-09-19)

A read-only post-implementation audit (four parallel deep-dives, independently re-verifying code/tests/migrations rather than trusting this document) found the six phases substantially complete, with four confirmed gaps and a small set of named test gaps. This batch closed all four before any further feature work, each as its own commit with migration + implementation + tests together:

- **G8 -- legacy onboarding state.** A user with financial activity from before onboarding existed defaulted to `pending` on first profile read, forcing them through onboarding as new. `getProfile` now checks prior activity and starts `legacy` instead; a one-time idempotent backfill migration (`20260919100000_legacy_onboarding_backfill`) reclassifies existing unreviewed `pending` profiles and creates missing profile rows the same way, touching nothing already reviewed or completed. Commit `25e2e51`.
- **G3 -- real coverage acknowledgement.** `/onboarding/complete` only checked the client-sent `reviewed:true` flag; a client could claim review without ever calling `POST /journey/coverage`. `financialStatus()` now exposes `coverageAcknowledged`, computed from the same staleness checks already driving the coverage blockers (current `dataVersion`, today's date, every source individually acknowledged); completion is rejected until it is true, so changed financial data invalidates a prior acknowledgement. `OnboardingPage.tsx` now actually calls the existing `confirmCoverage` endpoint before finishing, since the UI never had. Commit `360c932`.
- **G2 -- reverse import lineage.** `Expense`, `CreditTransaction` and `BankTransaction` could only be traced forward via `ImportRow.outputRef`; there was no indexed way back from a transaction to its session. Each model gained a nullable `importRowId` FK (migration `20260919134211_reverse_import_lineage`, `SetNull` on delete, matching the existing `statementImportId` pattern), set at commit time only for rows the commit actually creates -- a row resolved as a duplicate never reassigns lineage away from the pre-existing record's real origin, and a retried commit does not touch it a second time. Commit `bceebfc`.
- **G1 -- unbounded historical event generation.** With `includeOverdue=true`, `buildUpcoming` generated one occurrence per elapsed period from a recurring payment's or manually-computed loan's original anchor date with no lower bound -- a stale `nextPaymentDate` or an old loan start date could produce hundreds of events on every `financialStatus()` call, each blocking the daily allowance until decided; the same unbounded lower bound existed at the DB level for reminders and bank-file loan schedules. Bounded to 366 days back from today. A decision already recorded on an old occurrence is unaffected, since `commitments.service.ts` re-injects it from its own persisted snapshot regardless of this window -- the bound only limits how far back a *never-decided* occurrence is still auto-generated for review. Commit `1d22e98`.

Additional named test gaps from the audit closed in the same batch (commit `855bbbe`): an own-account internal transfer is never counted as an expense; a credit-card settlement bank row doesn't double the confirmed purchases it settles; a cash-only user (no bank/credit accounts) gets correct monthly totals with allowance explicitly unavailable; the multi-account allowance blocker fires only on a second bank account, not a second credit card; two genuinely identical rows in one fresh import file both survive as separate expenses when nothing pre-existing matches either.

**G7** (reminder with an unknown amount and a non-`expected_expense` type) was investigated, not implemented: `ReminderType` has exactly one financial-category value (`expected_expense`); the existing check in `cashflow.service.ts` already implements the plan's financial-vs-non-financial reminder distinction correctly. No bug found, no change made.

Validation for this batch: backend suite 365/365 passed (up from the prior 337, all newly added tests are net-new coverage, not replacements of weakened assertions), full Playwright E2E 22/22 passed (the prior audit's "22 vs. up to 24" concern was a miscount -- the spec file has 11 `test()` calls x 2 projects = 22, matching exactly), backend and frontend typecheck/lint clean, frontend production build passed, all 21 migrations applied with zero schema drift, all six real fixtures present with five golden entries.

Deliberately not touched in this batch (P1/P2, tracked separately, not correctness bugs): server-side transaction pagination, lint-warning cleanup, dead-code removal (`AttentionPanel`/`getAttention`/`buildAttention`/`mergeAttention`, `imports/smartImport.service.ts`), `metrics.service.ts` redefining its financing/confirmed filter instead of importing it from `dashboardRepository`, the weekly check-in's per-stage UI content fidelity against the plan's table, and the multi-account funding-allocation model itself.

## Plan completion batch (2026-09-26)

Built the open roadmap items and audit P1/P2 in dependency order, each as its own commit, with banker review on every financial change (all approved after fixes).

| Commit | Scope |
| --- | --- |
| `97cf5d8` | One `spendingCredit` / `spendingCreditInMonth` predicate replaces nine copies of the confirmed + non-financing filter |
| `b80bcbd` | Dead code removed (smart-import service, updates ticker module, `/dashboard/attention` and `/dashboard/upcoming`, orphaned panels, compatibility upload wrappers) |
| `3a9dd0c` | Regression fix: reminders could no longer be created after the journey rewrite; the calendar opens the form again |
| `cd001a1` | 4.2 activity log (`activity_events`, `/activity`) |
| `bcad568`, `553ab15` | 3.3 goals: savings / purchase / loan payoff; payoff progress read from the loan balance with its date; goal edit no longer resets the saved amount |
| `1277530` | `Income.source` provenance, backfilled from bank links |
| `f869ed2` | `monthTotals` returns `balance`; reports and insights drop their own copies of the monthly sum |
| `6286ed5`, `1d79324` | 2.1 / 4.4 question answering (household and per document), gross-then-net interest, planned interest never called charged |
| `2ab4b5b` | 2.4 command palette and `/search` |
| `558da7f` | 4.3 bottom sheets, ActionMenu, quick-add FAB, breadcrumbs |
| `1fdc109` | Server-side pagination and filters for the expense and income ledgers; `monthSpend` replaced by `monthTotals` |
| `d9340df` | Frontend lint: 20 warnings → 0 |
| `1c55be9` | Multi-account funding allocation per the banker ruling of 2026-09-26 |

Validation: backend `npm test` 480/480 (49 files, run alone); typecheck, test typecheck, lint and build clean; `test:fixtures` all present with golden entries; 29 migrations applied, `prisma migrate diff` shows no difference. Frontend build clean, oxlint 0 warnings. Playwright main config with `MONEY_JUNGLE_DESIGN_E2E=1 MONEY_JUNGLE_REAL_E2E=1`: 64 passed (26.4 min) against the backend restarted on the current code. Assistant real-API suite: 12 passed. New browser cases cover the calendar reminder, activity log, payoff goal, questions, command palette, mobile sheets and menu, ledger paging, and funding allocation.

Deferred by earlier decision, unchanged: OCR, the `unused_subscription` alert. Gated by the research plan until v1 is validated on real data: periodic-expense planning, variable-income scenarios.

Open, not fixed in this batch:
- `credit.service` `attributionDateOf` stores the transaction date in `billingDate`. That contradicts CLAUDE.md §5, and the "מועד חיוב" wording in `financeTerms.ts` may describe the opposite. Needs a domain decision.
- There is no "cash" paying-account option. With several accounts, a cash-paid obligation stays unassigned and blocks the allowance.
- Model routing for free-form questions is tested only with an injected provider. No `ANTHROPIC_API_KEY` is configured locally.
- The DB still holds no real data (wiped 2026-09-19). Real-data verification of the new flows is through the fixtures and disposable accounts only.
