# Money Jungle journey contracts

## Ownership and financial consistency

All journey and import records belong to one authenticated `userId`. Family members are labels, not shared ownership. Financial HTTP reads/changes share a per-user transaction lock; nested Prisma work reuses that transaction. Responses are released after commit. Uploaded bytes and an `uploaded` session persist before parsing, so parser failure can be retried. Document provenance is required for commit, and unreferenced file deletion is deferred until the transaction commits.

`FinancialStatus.dataVersion` fingerprints the persisted financial revision and source data. Coverage acknowledgements identify each account/card and its source revision. Observed transaction dates are not claimed to be a statement's reported coverage. A mutation invalidates earlier coverage and stale decisions are revalidated against their evidence. A daily allowance requires current anchors and explicit coverage. Multi-account funding allocation remains unavailable; the UI explains why. Missing data is not treated as zero. Monthly recorded surplus and savings-goal progress are not cash available for spending.

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

Apply the new migrations forward, in order, using the normal deployment process; do not edit already-applied migrations. Local validation uses MariaDB plus all six real fixtures/goldens. Browser tests mock HTTP and validate interaction only; the backend integration suite covers ownership, transactions, parsers and money invariants. See `money-jungle-implementation-progress.md` for the release run and commits. No remote deployment is implied by these local commits.
