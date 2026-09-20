# Money Jungle visual redesign

Research and decisions recorded before UI implementation, 20 September 2026.

## Evidence and application

| Finding | Source and limits | Decision for Money Jungle |
| --- | --- | --- |
| Scale, contrast and grouping establish reading order. Equal emphasis weakens hierarchy. | [NN/g: Visual hierarchy](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/), [visual principles](https://www.nngroup.com/articles/principles-visual-design/). General UX guidance, not a fintech conversion experiment. | One clear page title, one leading financial answer, quieter context, then details and actions. |
| People can compare position and length more readily than arbitrary decorative differences. | [NN/g: Dashboard perception](https://www.nngroup.com/articles/dashboards-preattentive/). | Aligned amounts, tabular digits, common chart scales and readable labels. No decorative chart backgrounds. |
| Progressive disclosure reduces initial complexity but should not hide the core task or become deeply nested. | [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/). | Keep search/category and essential status visible. Put uncommon date/recurrence controls and methodology in labeled disclosures. |
| Applied filters need visible context and a quick removal mechanism, including on mobile. | [Baymard: Applied filter overviews](https://baymard.com/research-articles/how-to-design-applied-filters), updated May 2026. Ecommerce evidence; applying this to financial transaction search is a design inference to validate. | Show removable filter chips and result count outside the advanced filter panel. Preserve URL/back/reload behavior. |
| Cards suit heterogeneous independent content; a card grid does not automatically establish order. | [NN/g: Cards](https://www.nngroup.com/articles/cards-component/). | Reserve contained surfaces for financial summaries, forms and distinct tasks. Lists and related details use spacing and quiet separators rather than boxes inside boxes. |
| Dense tables need room, aligned columns, contextual tools and readable row states. Supplementary detail can expand. | [IBM Carbon: Data tables](https://carbondesignsystem.com/components/data-table/usage/). Established system guidance. | Keep transaction identity and amount prominent. Use compact desktop rows, readable mobile records and distinct secondary metadata. Keep all actions available. |
| Empty states differ by cause: first use, no matches and failed loading require different next actions. | [Carbon: Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/). | Offer add/import for first use, clear filters for no matches, retry for errors. Never substitute zero for unknown money. |
| Semantic tokens and type roles let brand variation share consistent behavior. | [Material Web: Theming](https://github.com/material-components/material-web/blob/main/docs/theming/README.md), [typography](https://material-web.dev/theming/typography/). The M3 website requires JavaScript; these official implementation docs were readable. | Separate palette references from surface/text/action/status roles, with one type/space/component system across eight themes. |
| Adaptive layouts reorganize navigation and content instead of stretching or merely shrinking controls. | [Google: Adapt layouts](https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout). Native guidance applied to responsive web, not a web requirement. | Desktop rail, mobile bottom navigation, wrapping tools, readable records; tablet layouts use available width without giant gaps. |
| Text, controls, focus and reflow have measurable accessibility requirements. | W3C: [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [24px target minimum with exceptions](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). | At least 4.5:1 normal text and 3:1 required component boundaries/focus. Aim for 44px interactive targets. Validate 320px reflow, RTL, zoom and keyboard. Never use color alone for a financial state. |
| Motion is useful for feedback and continuity; attention-grabbing movement competes with the task. | [NN/g: Purpose of animation](https://www.nngroup.com/articles/animation-purpose-ux/), [W3C: Animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) (AAA). | Short color feedback and loading status, no floating/animated balances or decorative movement. Respect reduced motion. |

## Product audit

The supplied screenshot is not present in the accessible conversation assets; the audit uses the running application and repository instead. Baseline screenshots are captured against the real local API, with disposable empty, partially populated and dense accounts. The dense fixture contains six months of transactions, refunds, long Hebrew merchant/category names, bank/card identities, budgets, a loan, an asset, savings and an alert. These are synthetic records stored in the real database, not mocked HTTP responses or customer financial data.

Recurring issues found in the existing implementation:

- A small sticky header, global month strip, quick-add box, tabs, page toolbar and filter box stack before the ledger. These compete with the task and delay the first useful row.
- Many page headings are absent from the content or repeated inconsistently. Navigation uses assorted emoji; primary and secondary navigation compete.
- Eight palettes provide colors but no semantic surface, control-boundary or spacing roles. Several dark themes' muted text is too dim. Small white text on the red theme's primary button needs correction.
- Borders, KPI boxes and nested cards have similar visual weight. Empty areas and generous card padding coexist with cramped controls and small type.
- Money is uniformly monospaced; routine expenses are all red, including refunds. Amounts need strong alignment and context, not blanket alarm coloring.
- Filter state persists in the URL, but controls sprawl and selected constraints are hard to summarize. Advanced controls can be disclosed without removing them.
- Mobile table cards give every field equal emphasis, creating long repetitive records. The More navigation dialog lacks a complete keyboard focus lifecycle.
- Budget category work is below secondary charts. Account and report hubs need a clearer relationship between context, totals, tabs and their content.
- Setup/Imports carry necessary validation but can group information into clear next actions. Forecast/Net Worth must keep uncertainty visible without making every explanation a prominent box.

## Chosen visual language: a calm financial workspace

This is a product-design decision informed by the evidence, not a claim that one aesthetic has been experimentally proven best for this app.

- **Hierarchy:** page identity → financial answer/current task → relevant action → supporting detail. Financial data takes priority over framing.
- **Typography:** Heebo for Hebrew and UI; a small role-based scale. Tabular, isolated LTR digits for amounts, with weight and size differentiating totals from rows. Secondary labels remain readable.
- **Spacing:** shared 4/8/12/16/24/32 scale, consistent content gutters and aligned edges. Density comes from removing redundant structure, not tiny targets.
- **Surfaces:** canvas, primary surface and quiet inset surface. Borders for controls and actual separation; shadows only for elevated overlays. No glass effects or decorative gradients.
- **Actions:** filled primary, quiet secondary and text/ghost tertiary. Local actions sit near their content; irreversible actions keep explicit labels and confirmation.
- **States:** neutral routine money, positive receipts/refunds, negative deficits/overruns, warning attention, explicit unknown/estimated labels. Color always has textual or symbolic context.
- **Navigation/icons:** consistent line icons paired with labels, strong current location, lighter secondary destinations, keyboard-safe mobile navigation.
- **Filters/records:** common tools first, labeled advanced disclosure, visible removable constraints, stable totals and readable identity/date/category/amount. Financial computation and source ownership remain unchanged.
- **Charts:** clear labels, restrained grids, consistent theme colors, no misleading decorative fills. Keep underlying explanatory data accessible.
- **Responsive:** one hierarchy, reorganized for width. At narrow widths keep identity and amount together and move secondary fields below; never discard financial information to fit.

## Implementation stages

1. Research, real-data baseline and audit (before any UI/CSS change).
2. Semantic tokens, shared type/spacing/surfaces, navigation, controls, cards, tables, loading/empty states, icons and chart chrome.
3. Primary tasks: Home, Transactions, Budget, Accounts & Debts, Reports, Imports, Setup, Forecast/Net Worth, Settings and secondary screens.
4. Real-data visual review; empty/partial/dense, desktop/tablet/mobile, all themes, long text, positive/negative values, alerts, filters, keyboard/focus/contrast/reduced motion.
5. Full regressions, build/typecheck/lint, logical commits and push to main.

## Validation and remaining work

Validated against the real local API with disposable empty, partial and dense accounts (`MONEY_JUNGLE_DESIGN_E2E=1`, `frontend/tests/e2e/design.real.spec.ts`), desktop and mobile projects:

- All primary routes render without page errors, RTL and horizontal overflow at desktop, 768px and 320px.
- axe-core (WCAG 2.0/2.1/2.2 A and AA) is clean on every primary route in all eight themes; resolved token pairs meet 4.5:1 text and 3:1 control-boundary ratios. Failures found and fixed: danger text on the dark-luxury theme, and danger/warning/success text on the light theme.
- Filters keep URL state, applied-filter chips remove individually, dialogs restore focus, tabs respond to arrow keys, and the mobile More dialog traps focus.
- 320px `/reports` overflowed because the chart grid had a fixed 380px column minimum; fixed with `minmax(min(380px, 100%), 1fr)`.

Screenshots are written to `docs/design/screenshots/` (git-ignored, regenerate with the spec). Automated checks do not replace user testing or a full WCAG audit; the research table's ecommerce-derived filter guidance remains a design inference to validate with users.
