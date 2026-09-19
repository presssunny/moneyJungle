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
