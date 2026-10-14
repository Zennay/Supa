# SUPA M3 — current planner acceptance & field-proof boundary

**2026-10-14 · quality-validation 2/2 · synthetic-only; no M3 release approval**

This is a regression contract for the **actual M3 planner on `main`** after product owner work on [private manual week sharing #2459](https://github.com/Zennay/Supa/pull/2459), [active ingredient overlap #2460](https://github.com/Zennay/Supa/pull/2460), and [exact physical quantity entry #2458](https://github.com/Zennay/Supa/pull/2458). It is *not* evidence of a shop visit. The independent QA branch started at `fbd74a357010b5ca24b9a612f428c6eef505065b`. A newer main must be re-tested at its exact SHA before landing.

## What this branch actually tests

| Contract | Executable evidence | Truth boundary |
| --- | --- | --- |
| Every current meal selection | `tests/qa-m3-reuse-week-share-cross-flow-matrix.test.mjs` independently checks **3⁴ recipe configurations × 2⁴ active-day subsets = 1,296** combinations. | Only the selected active day/recipe lines may be copied; no stale/inactive meal. |
| Ingredient overlap | Independent per-ingredient, per-day oracle checks each shared ingredient ID, label, order, recipe/day membership and meal counts for every non-empty subset. | Does **not** imply a leftover quantity, pack reduction or a financial saving. |
| Private manual sharing | Copy text starts with budget OFF and preparation/servings OFF. One explicit budget opt-in does not affect reuse calculations. | No retailer price, default personal-budget disclosure, automatic copy or network transfer. |
| Real rendered App | Vite/React SSR checks primary planner → reusable ingredient explanation → optional sharing, two unchecked privacy controls, absent textarea before user action. | SSR is not a substitute for a trusted Firefox/mobile interaction run. |
| Observation/integrity proof | `tests/m3-qa-release-gate-evidence-matrix.test.mjs` replays **nine unchanged historical independent gates** from [#2064](https://github.com/Zennay/Supa/pull/2064), original Git blob `8e5ca74309916b72bf840eac1116b12906d9d814`. | A blank or partly unavailable 11 + 11 sheet stays *unknown/null*, not a public saving; participant identifiers absent. |
| Source/output preservation | Independent synthetic M3 generator → converter → assessor path with separate temporary files, original bytes unchanged. | Does **not** resolve open alias/race issues [#2035](https://github.com/Zennay/Supa/issues/2035) / [#2039](https://github.com/Zennay/Supa/issues/2039). |

## Go/no-go checklist

- **Current state: M3 ACTIVE**, not M4 or M5. Human [#78](https://github.com/Zennay/Supa/issues/78): the same 11 demanded items, authentically observed at PLUS and DekaMarkt within 24 hours in the same chosen price context. No synthetic fixtures qualify.
- Keep source provenance, store identity, observations and retailer use-permissions independently documented and human-reviewed. Neither SSR nor a successful CI proves access rights, authentic prices, observed savings or beta eligibility.
- Before merging any test code: ensure owner-independent review, isolated changed-file list, fresh current-`main` composition, **exact-head** npm test/high security audit/M1 matching/source permission/TypeScript-Vite build, and applicable zCloud scoped task claim/lease requirements. Permanent browser/mobile checks must be recorded as `QUEUED`, `PENDING`, `SUCCESS` or `FAILURE` **by their real outcomes**, never inferred from hosted CI.
- Product source owners and independently active branches [#2359](https://github.com/Zennay/Supa/pull/2359) and [#2361](https://github.com/Zennay/Supa/pull/2361) were **not modified** for this evidence. Do not use this test PR as M3 release authorization or a deployed storefront.

## Reproduction

On an authorized, isolated checkout of the exact review head:

```sh
npm ci
node --experimental-strip-types --test tests/qa-m3-reuse-week-share-cross-flow-matrix.test.mjs tests/m3-qa-release-gate-evidence-matrix.test.mjs
npm audit --audit-level=high
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

All monetary amounts and input data in these tests are **fictional** and must never be copied to a real retailer dataset, public saving message or student beta.
