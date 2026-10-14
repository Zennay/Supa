# Independent Supa M5 cohort QA — 14 October 2026

## Source and scope
- Independent quality-validation worker 2/2, child of frozen [product PR #2342](https://github.com/Zennay/Supa/pull/2342), exact HEAD `85636ceaa3f3fed523d2106a94ca0a5247913e5c`; source product owner has completed [hosted CI #38513582604](https://github.com/Zennay/Supa/actions/runs/38513582604) with 1,247/1,247 Node passing.
- This QA branch modifies only add-only tests and this note. Product-core issue [#2343](https://github.com/Zennay/Supa/issues/2343) (same *individual* source object across independently allocated arrays) belongs to the parallel product owner and is NOT presumed fixed or tested green here.
- Test inputs are entirely invented, in memory, using canonical M1 `inspectHtml` and M5 comparison/queue APIs. No live retailer requests, real prices, participant data, UI, filesystem fixtures, runner workflows, or main changes.

## Independent tests
The independent suite `tests/qa-m5-cohort-provenance-independent-20261014.test.mjs` tests own immutable baseline/source identity, empty and unavailable captures, historical removal, real mocked HTML shape drift, P1/P2/P3 triage, strict null/undefined vs falsy histories, own descriptor precedence and getters, privacy and always-false release/source rights. The source array must never be reused as its own historical cohort; separate source-object clones must remain permissible purely for manual review, not evidence of real observed prices.

## Acceptance
Require exact-head full hosted Node test, high npm audit, M1 matching and source permission gate, TypeScript/Vite build. Also replay prior independent QA trust files unchanged on this newer product source. QA cannot declare human M3 complete from fictional data.

## Release status
**M3 ACTIVE / #78 human field observation missing. M4/M5 INELIGIBLE.** Original Plus 11 / DekaMarkt 11 same-demand prices within 24 hours in one price context remain unobserved. All results DRAFT/HOLD/NO MERGE/NO DEPLOY until independently verified zCloud SQLite task/write lease, original source and QA owner reviews, current-main/trusted runner where applicable, actual source rights, authentic field proof and explicit human releasego. This draft is not a production deployment.
