---
target: UI Map full CRM manual run
total_score: 20
p0_count: 1
p1_count: 3
timestamp: 2026-07-06T06-36-02Z
slug: backend-console-src-pages-uimappages-tsx
---
# UI Map Full CRM Manual Critique

Target: backend/console/src/pages/UiMapPages.tsx
Manual UI run: configured 20 CRM/demo routes through App setup -> Scan profile, ran Map UI preflight, triggered backend scan, refreshed manually, opened /dashboard/crm detail.

## Design Health Score

Total: 20/40, Acceptable but not user-facing ready.

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 1 | Triggering the backend scan starts async work but the UI does not poll or show progress/completion. |
| 2 | Match System / Real World | 3 | Terms mostly make sense for admins, but selector quality and route discovery still assume implementation knowledge. |
| 3 | User Control and Freedom | 2 | Admin can refresh and open detail, but cannot cancel scan, resume from progress, or recover obvious scan state. |
| 4 | Consistency and Standards | 3 | Layout and controls are consistent after the console polish pass. |
| 5 | Error Prevention | 2 | Preflight samples only the first five routes and does not warn that scan result will require manual refresh. |
| 6 | Recognition Rather Than Recall | 2 | Admin must know routes manually; route discovery is hidden away from the mapping task. |
| 7 | Flexibility and Efficiency | 1 | Reviewing 1,265 elements / 520 weak selectors has no search, grouping, bulk action, or source-code fix guidance. |
| 8 | Aesthetic and Minimalist Design | 2 | The page is cleaner, but the scanned-page table and detail table are too raw for operator review. |
| 9 | Error Recovery | 2 | Errors are visible, but stalled scan perception has no recovery guidance. |
| 10 | Help and Documentation | 2 | Inline help exists, but not enough to help a new admin map any arbitrary product. |

## Evidence

- Route list accepted 20 routes.
- Preflight passed selected routes but only reachability-checked the first five.
- After clicking Trigger backend scan, the page continued to show the old 1-page map for 120 seconds because no polling occurred.
- After clicking topbar Refresh, the completed map appeared: 20 pages, 1,265 elements, 244 strong selectors, 501 medium selectors, 520 weak selectors, 28 captured states.
- /dashboard/crm detail opened with 74 mapped elements. Important CRM opportunity edit actions had strong data-ai-id selectors, but global nav, pagination, account menus, date filters, and repeated text controls produced many weak or ambiguous selectors.

## Priority Issues

[P0] Async scan status is invisible. Admins do the right thing and see stale results until manual Refresh. Fix with a UI-map scan job state, polling, progress row, completion toast, and automatic refresh to the new version.

[P1] Full-product route setup is too manual. A raw textarea is not enough for any-product onboarding. Fix with route discovery in the Map UI flow, sitemap/import support, route chips, reachability results for all routes, and saved scan profiles.

[P1] Review output is not operable at scale. 1,265 rows and 520 weak selectors cannot be reviewed one-by-one. Fix with route/component grouping, weak-selector triage, search/filter counts, bulk dismiss/assign, and exportable source annotations.

[P1] Selector remediation points at admins instead of product builders. The UI says add data-ai-id/data-testid, but does not identify the owning component, repeated selector family, or highest-impact fixes. Fix with a source-fix report grouped by selector pattern and route.

[P2] The scanned page table is hard to scan. Every page has the same page title, so the route column carries the entire meaning. Fix with route-first layout, page aliases, last scan status, and changed/failed route badges.

## Persona Red Flags

Alex, power admin: Cannot complete mapping efficiently because scan progress is invisible and selector review has no bulk workflow.

Jordan, first-time admin: Can follow the broad steps, but will not know how to discover all routes or what 520 weak selectors actually require.

Sam, accessibility-dependent admin: Standard controls are mostly keyboard reachable, but the giant dense tables and non-persisted preflight state make review cognitively expensive.

## What Works

- The backend can eventually scan all explicit CRM routes.
- Preflight and privacy concepts are placed in the right general flow.
- Strong selectors are excellent where the target product already has data-ai-id attributes.

## Verdict

This is technically capable, but not admin-friendly enough for arbitrary customer products yet. It works for a technical operator who already knows route structure and selector strategy. It is not easy enough for a normal customer admin to map their own product confidently.
