# Household assistant — implementation handoff

## Scope

Research: [household-finance-ai.md](household-finance-ai.md). Entry point: **הגדרות וניהול → העוזר המשפחתי**, `/assistant`.

This first version reviews recorded household finances and offers the next steps. It includes a conservative duplicate-candidate scan, current-month totals, existing coverage limitations and upcoming/open commitments. It is not an autonomous bookkeeper or a free-form financial chatbot.

## Server contract

- `GET /api/household-assistant`: owner-scoped snapshot, version, generation time, authoritative totals, allowance, blockers, up to 30 existing journey actions, commitments and duplicate evidence.
- `POST /api/household-assistant/plan`: strict `{ version, consent: true }`; rejects stale input with 409. Uses a configured model to select temporary task IDs. Returned IDs are validated and mapped to server-owned actions. Priorities ≤25 stay ahead of model selections. Changed data during inference returns `mode: "stale"` and no selections.
- Model errors, invalid JSON, invented/duplicate IDs or absent configuration return deterministic steps (`mode: "rules"`). SDK requests receive a 15-second abort signal. Neither endpoint accepts a client-supplied owner.
- `GET /api/household-assistant/duplicates/:id`: the full record set of one candidate group, re-read at request time. A group that no longer exists returns 409 rather than a stale list.
- `POST /api/household-assistant/duplicate-reviews`: strict `{ requestId, candidateId, version, decision, confirmed: true }`, plus `removedKey`/`keptKey` for `remove_manual` only. Rejects a changed group with 409, a reused `requestId` carrying different content with 409, and replays an identical one without repeating its effect.
- `GET /api/household-assistant/duplicate-reviews`: the decision history, newest first, 20 per page with a cursor; `followUp=true` returns only charges awaiting issuer clarification.
- `POST /api/household-assistant/duplicate-reviews/:id/undo`: strict `{ version, confirmed: true }`. Reopens the group and restores a removed row with its original identity, month, category, payment method and recurrence. Blocked with an explicit reason when the retained sources changed, the ID is taken or the original category/payment method is gone.
- Existing session authentication and CSRF protection apply. Limits are per authenticated user (30 scans / minute, 5 plan requests / minute), including users sharing an IP. The existing login limiter still uses its original IP behavior.
- One migration, `20260923120000_duplicate_reviews`, adds the `duplicate_reviews` audit table. No financial formulas, import deduplication, reconciliation rules or approval requirements changed. Snapshot collection reuses existing journey reads, which may initialize a profile, generate alerts or persist already-established automatic commitment verification.
- `remove_manual` is the assistant's only financial mutation, and it deletes through `expensesService`/`incomesService` inside the existing owner transaction, so the deletion and its audit record commit together or not at all. Imported card charges are never deleted here. A removal bumps the financial revision, which invalidates coverage acknowledgement exactly as any other money change does.

## Duplicate scan boundaries

The most recent 90 calendar days through the Jerusalem business date; at most 2,000 rows per source, explicit `limited` when exceeded. Manual expenses without import lineage; incomes not linked to bank rows; confirmed regular/standing-order card transactions with a known card and `paymentCount=1`. Known bank-linked outputs, drafts, installments, financing and refunds are excluded. Existing import workflows continue to handle uploaded overlap/identity cases.

Comparison uses positive signed amounts rounded to cents, normalized exact names and the same date. Same-source groups preserve payment-method/card/income-type identity. A manual expense can also match card evidence unless its payment method contradicts that. Repeated genuine purchases can be candidates: no automatic deletion, no claimed probability, no assumed savings. Response displays at most 50 groups / 20 records per group and exposes total counts.

Dates used for this *identity check* are the transaction date. Monthly financial totals remain entirely from `monthTotals`, including the existing `billingDate` and financing rules. The two purposes must not be confused in future refactors.

## Duplicate review decisions

Three decisions: the records are separate transactions, a manual row was entered twice and one copy should go, or the charges are genuinely on the statement and need clarification with the issuer. Only the second removes anything, and only a manual expense or income — never an imported card charge. The third changes no amount at all; it records a follow-up the household still owes itself, and the money stays in the totals until the issuer question is settled.

Every decision is bound to a `version` fingerprint of the exact rows it was made about. Editing any of those rows invalidates the decision: the group returns to the review list marked as reopened, the history entry reads as stale, and the legacy `duplicate_transaction` alert reappears. A new row joining the group reopens a whole-group decision too, since the question the household answered was about a different set of records. This is deliberate — a saved judgement is about evidence, not about record IDs.

Undo restores the removed row from a snapshot taken before deletion, recreating it under its original ID. It refuses rather than partially rebuilds: if the retained rows changed, the ID was reused, or the original category or payment method was deleted, the history shows why and nothing is written.

The scan and the `duplicate_transaction` alerts read the same persisted evidence, so a group confirmed as separate stops raising both. Those alerts now follow current evidence — an alert for a group that is no longer detected is removed rather than left standing — and the review history, not the alert list, is the durable record.

## AI configuration and privacy

Use the existing server-side `AI_PROVIDER`, `ANTHROPIC_API_KEY`, and `ANTHROPIC_MODEL`. Configure a model available to the operator's Anthropic account. No keys belong in frontend configuration. The local environment inspected during implementation has no configured provider key; no live paid inference was performed.

Each invocation requires an explicit checkbox and button. The model receives only temporary task IDs, task types/priorities and whether the picture is incomplete. Merchant, household, file and account names, amounts, dates, uploaded documents and source record IDs are omitted. The existing provider also includes its opaque internal user ID as API metadata. It is not a bank account number. No provider output is rendered as free text, HTML or a URL; the model cannot create an action.

Successful read-only plan POSTs deliberately do not emit the shared financial-mutation browser event. A plan is only displayed for the matching snapshot version. The feature works without provider configuration and makes that visible.

## Validation

- Backend: 414 tests passed, including 26 added tests; all six real statement/schedule fixtures and golden data present. Tests cover signed/different/multiple records, source identity, bank links, drafts, financing, installment exclusions, tenant isolation, stable snapshots, unchanged monthly totals, CSRF, consent, stale requests, in-flight changes, provider failures, invented output, cancellation propagation and per-user limits.
- Backend build, typecheck, test typecheck and lint passed. Frontend build passed; lint has the existing 22 warnings in unrelated files and no new warnings.
- Duplicate review (added after the sections above): backend 429 passed across 42 files, including 15 integration tests covering exact-once correction, full-field restore, immutable card charges, issuer follow-up, stale evidence, reopening on edits and new members, blocked undo, rollback when the audit fails, concurrent and replayed requests, pagination, ownership/CSRF/confirmation, and the legacy alert interaction. Real-API browser suite 10 passed across desktop/mobile, including the decision dialog in all eight themes with axe WCAG A/AA, keyboard focus order and dialog overflow. Existing mocked journey regression: 32 passed. Backend typecheck/test-typecheck, frontend build and lint clean. Verified against the real local database, with disposable synthetic accounts.
- New real-API browser suite: 6 passed across desktop/mobile and empty/partial/dense disposable accounts. Populated scenarios exercise all 8 themes, RTL, axe WCAG A/AA checks, overflow, source links, keyboard activation and reduced-motion preference. Tablet 820px also checked. Data is persisted through real application APIs/database; the disposable dataset is synthetic. The existing parser/import regression suite separately uses real financial files.
- Existing journey/onboarding browser regression: 38 passed initially; the two navigation tests expected four management destinations before this feature added a fifth. Updated that expectation, asserted the assistant destination, and reran both successfully (40 existing scenarios covered). The 10 broader visual-redesign audit cases were not rerun in this assistant change; the new assistant's eight-theme audit ran separately.
- Screenshots: [desktop](screenshots/dense-assistant-desktop.png), [mobile](screenshots/dense-assistant-mobile.png), [tablet](screenshots/dense-assistant-tablet.png). Inspected desktop/mobile renders. Full-page mobile captures show fixed navigation at the viewport boundary; this is capture behavior, not a mid-page navigation position during use.

Run the isolated browser suite from `frontend`:

```sh
MONEY_JUNGLE_ASSISTANT_E2E=1 node node_modules/playwright/cli.js test --config playwright.assistant.config.ts
```

It starts its own backend on 3015 and frontend on 5185, disables the external model and deletes only its disposable fixture users. Normal development ports are unchanged. `MONEY_JUNGLE_API_TARGET` is a server-side Vite proxy override for isolated regression environments.

## Follow-up boundaries

Live provider availability, response quality/cost and the configured model still need verification after operator configuration. The model contract is tested with injected provider responses; an automated accessibility scan is not a complete assistive-technology audit. Duplicate precision/recall needs a consented, labelled household dataset before enabling fuzzy matching. Automatic classification, income scenarios, periodic-expense planning and multi-user household sharing remain separate future work, described in the research document.

Issuer follow-up is a note to the household, not an action: nothing is sent to the card issuer, and no one is reminded after the first time the entry appears in the tracking list. Decision history is kept indefinitely and has no export. Restoring a removed row depends on the archived snapshot, so a restore attempted long after the surrounding data moved on will correctly refuse more often than it succeeds.
