# Money Jungle journey contracts

## Ownership and financial consistency

All journey and import records belong to one authenticated `userId`. Family members are labels, not shared ownership. Financial HTTP reads/changes share a per-user transaction lock; nested Prisma work reuses that transaction. Responses are released after commit. Uploaded bytes and an `uploaded` session persist before parsing, so parser failure can be retried. Document provenance is required for commit, and unreferenced file deletion is deferred until the transaction commits.

`FinancialStatus.dataVersion` fingerprints the persisted financial revision and source data. Coverage acknowledgements identify each account/card and its source revision. Observed transaction dates are not claimed to be a statement's reported coverage. A mutation invalidates earlier coverage and stale decisions are revalidated against their evidence. A daily allowance requires current anchors and explicit coverage. With several bank accounts the daily allowance is planned from one chosen spending account (`FinancialProfile.spendingAccountId`); every obligation needs a confirmed paying account (`FundingAssignment`, `GET/PUT /api/journey/funding`), another account's shortfall becomes a transfer owed by the spending account, and money elsewhere is never counted. `allowance.cash` is the combined balance; `allowance.cashInPlan` is what the calculation uses. Missing data is not treated as zero. Monthly recorded surplus and savings-goal progress are not cash available for spending.

## Financial setup and coverage

`PATCH /api/journey/situation` saves nullable account, card and loan counts (integers from 0 to 100) and a nullable cash-activity choice. Blank means unknown; zero means none. Saving changes the financial revision and invalidates the previous coverage acknowledgement. The additive migration `20260920160000_financial_picture` must be applied before running the updated API; it adds the nullable `financial_profiles.situation` field.

Journey status and Home include a server-derived `picture`: inventory, observed months, required gaps, capabilities and ranked next actions. Gaps between observed months are suggestions to review history, not proof of missing activity. A computed loan schedule remains an estimate; dates do not prove payment. Declared missing accounts/cards/loans and cards without transaction detail or an explicit no-charges acknowledgement prevent completion and a daily allowance.

Coverage confirmation still requires the current `dataVersion` and every current source key. It also accepts `quietSourceKeys` for explicit no-charges acknowledgements. The UI offers this only for cards without recorded transactions and never infers it from an empty list. These confirmations stop applying when the financial data or day changes. Completion still requires reviewed inputs, declared scope and current coverage; manual setup without useful financial data still requires an explicit no-activity choice.

Home remains accessible during setup without marking onboarding complete. The three onboarding steps reflect server status; navigation, opening details and switching themes do not acknowledge coverage. Contextual links target the relevant account balance, card, scope or coverage section on `/data`.

## Imports

The canonical entry is `/imports?session=<uuid>`. Upload, questions, 50-row review pages, row corrections/duplicate decisions, commit and completion use the durable session. Responses include optimistic `version`; source corpus changes invalidate the preview. Expense/credit fields can be corrected. Bank and amortization monetary fields remain tied to the source file: use a corrected original file to change them. Explicit duplicate review preserves occurrence counts for legitimate identical transactions.

Commit records each output ID and an obligatory source document atomically. Completion verifies that the source and required reconciliation still exist. A repeated successful commit returns its stored result even if bytes are no longer readable. Rollback updates the session and source-dependent state. Shared file paths are reference protected.

Legacy HTTP upload routes return **202**, a session, `reviewUrl`, `Location`, and `requiresReview: true`; they do not write money. Frontend compatibility helpers delegate to the same session API.

## Metrics

`GET /api/journey/metrics/:name?month=YYYY-MM&page=1&version=<dataVersion>` supports `cash`, `allowance`, `commitments`, `income`, `expense`, `surplus`, and `creditCharge` (optional `card=all|unassigned|id`). It returns `FinancialMetric`: value/currency/state, as-of/period, source links, coverage, missing data, assumptions, formula/calculation version, data version and paginated components. Page size is 50; page 2 onward requires the first page's version. Stale versions return 409. Each response's header and rows share a transaction. Detail is requested only when opened.

Monthly totals reuse `dashboardRepository` through `monthTotals`; confirmed credit is merged at read time, financing is excluded, refunds retain their sign, and settled card totals are not counted again as expenses. Monthly source pages use stable source/id ordering. Cash explains each balance anchor and subsequent net movement. Allowance lists reserves and unpaid obligations and reports the limiting day. Commitments retain overdue debt and distinguish excluded paid/duplicate items and unknown sums. Next-card-charge pages include source reports, refunds, card identity and charge dates across billing months.

Loan schedule drawers retain bank-file versus computed provenance and interest/principal detail. Forecast shows its baseline periods, exclusions, scenarios and missing-data limitations. Health-score component points come from the same server calculation as the score. Budget pace and savings views explain their formula and limitations. These contextual explanations do not claim verified bank coverage.

## Browser state and refresh

Transaction query state includes `tab`, `month`, `q`, `category`/`type`, `uncat`, `recurring`, `from`, and `to`. Date filtering applies within the selected month. Tables separate filtered counts/sums from monthly totals; credit IDs remain distinguished by source and are read-only in the expense editor. Tables currently retain the existing monthly list APIs and client pagination; metric and import detail use server pagination. Analysis loads on disclosure and shares short-lived monthly reads with tables.

Successful mutations emit their domain. Financial summary resources observe financial changes; expense/income lists, account overview, wallet, documents, settings, lookup and CRM resources use explicit affected domains. Appearance changes do not invalidate money queries. Short-lived shared query promises coalesce identical table/analysis/lookup/metric reads, isolate users and invalidate on changes. Reload keeps active form components mounted and labels old data during refresh/failure. Quick Add retains earlier additions and does not remount the table.

Legacy standalone routes redirect to canonical hubs while retaining month/source/row/session and allowed `returnTo` query state. Return destinations are restricted to review/check-in or an import session. `/manage` exposes commitments, data/documents, alerts and settings. Bank/credit/loans remain entity management screens; CRM keeps its separate role gate. The product name is `Money Jungle` in all eight themes; saved theme identifiers are unchanged.

## Check-in storage and operational validation

Check-in snapshots use schema 2 / calculation `cash-v1`, retain at most 1,000 detailed records over three calendar months, and hash older history while reading ledger fields in batches of 500. Aging out is not deletion. Truncated detail produces unknown exact counts; changing historical windows does not claim comparable historic hashes. Completion is atomic/idempotent and stores the same ranked action/reason used by Home.

Apply the new migrations forward, in order, using the normal deployment process; do not edit already-applied migrations. Local validation uses MariaDB plus all six real fixtures/goldens. Browser regressions include mocked interaction checks plus opt-in real-API onboarding tests for uploads, manual setup and cards without charges on desktop and mobile (`MONEY_JUNGLE_REAL_E2E=1`). Real-flow tests create and remove disposable users and uploaded files. The backend integration suite covers ownership, transactions, parsers and money invariants. See `money-jungle-implementation-progress.md` for the release run and commits. No remote deployment is implied by these local commits.
