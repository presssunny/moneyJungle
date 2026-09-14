# Annual forecast and credit wallet

Implemented entry points:

- Reports → מבט קדימה (`/reports?tab=forecast`), also linked from Home.
- Accounts → Credit (`/accounts?tab=credit`) and the existing `/credit` route.

## Forecast contract

The forecast is an explanatory baseline, not a projected bank balance. The backend consumes the existing reports service, preserving the dashboard repository's money rules. It averages up to six elapsed months with both positive recorded income and positive recorded net expense, requires three eligible months, and projects the next twelve months. Activity is not proof of complete statement coverage; the UI says so. Users can exclude incomplete or unusual months. The current partial month is excluded. Months without activity appear as gaps in the chart.

Monthly income/expense changes and one additional dated expense form a separate, temporary scenario. Scenarios never write financial records. Expense reductions cannot produce negative spending. A rolling retrospective check uses only months before each target month and reports mean absolute expense error when enough history exists; it is not a calibrated confidence interval or an as-of-data audit.

Registered commitments are displayed separately and are not added to the historical baseline because the existing data lacks reliable links that could subtract the same recurring cost from history. Bank loan schedules supply dated payments, including final installments. Computed loan obligations stop at the configured end date. Recurring obligations never start before their configured anchor. Future credit installment balances, seasonal effects, automatic removal of completed loans from the baseline, and bank balance projections require additional reliable data and are not inferred.

The contextual tip is intentionally limited to one item and can be hidden for the current screen visit. This is rule-based guidance, not a learning model. Applied scenario selections and excluded months persist in this browser, separately for each authenticated account. Saved input is validated on load, and a new calendar month resets it so a one-time expense cannot silently move to another month. Unavailable browser storage does not prevent planning.

## Wallet contract

`CreditCard` stores owner, display name, issuer, last four digits and optional billing day. `CreditTransaction.cardId` is nullable for existing and mixed-card imports. A migration adds both without rewriting transaction amounts. Cards support creation and editing, whole-import assignment and individual transaction reassignment. Each endpoint scopes reads and writes to the authenticated user; foreign card/import/transaction IDs are rejected.

The wallet includes only confirmed imports. Spending uses `billingDate`; upcoming recorded charges use `chargeDate`. Refunds reduce expense, and financing is excluded and disclosed separately. Upcoming values represent recorded non-financing transactions, not a guarantee of the full statement charge. Unknown future dates and installment balances are not invented from billing day or payment count. Zero means no recorded net expense in that selection, not verified zero spending.

Selecting a card before upload scopes overlap matching to that card. Identical purchases on distinct known cards are retained. Exact file hashes remain deduplicated across cards. A card-specific import overlapping unassigned records is rejected with instructions to assign the older records before retrying, preventing ambiguous duplication or omission. Imports without an explicit card retain the existing legacy matching behavior; no automatic card identification is claimed.

Mobile cards form a horizontally scrollable wallet. Selection is stored in the URL, and the shared table handles pagination. Import management and extra summaries are disclosures, with a prominent import shortcut.

The wallet displays the actual creation date of the last confirmed import for the account. Refreshing the screen or uploading a pending report does not make that date appear newer. This metadata is distinct from the response calculation timestamp and does not claim full statement coverage. Shared tabs support RTL arrow navigation, Home/End, matching keyboard focus, and unique accessibility IDs for each hub.

## Validation

- Backend unit tests cover financial rounding, missing history, scenarios, retrospective leakage, charge attribution, refunds and financing.
- Authenticated integration tests use the real credit fixture and compare every covered month's wallet total to the existing monthly report. They also verify ownership, pending imports, card editing, cross-card duplicates, exact-file duplicates and ambiguous unassigned overlaps.
- Existing bank, credit and loan fixtures are present; the full backend suite is run against local MariaDB after migration.
- Browser checks use a temporary isolated account and the real API, covering desktop/mobile layouts, card selection/search, scenarios and input flows. Test account data is removed afterward.
- Deployment requires `prisma migrate deploy` and client generation before running the new backend. The additive migration has been applied to the local development database.
