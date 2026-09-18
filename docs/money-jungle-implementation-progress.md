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

## Remaining sequence
3. Durable parse failures/retry, editable paginated staged rows, lineage, atomic provenance, source lifecycle and all upload adapters.
4. Bounded versioned check-in snapshots, shared ranked action and meaningful comparison.
5. Metric source drill-down, scoped refresh, transaction URL filters and accessible review return paths.
6. Branding, route/UI cleanup, management groups, documentation and full release validation.
