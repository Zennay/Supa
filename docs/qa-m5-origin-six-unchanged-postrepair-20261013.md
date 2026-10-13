# Independent M5 source-origin after-fix verification — 2026-10-13

Supa current phase: **M3 ACTIVE**. Human same-demand 11+11 PLUS + DekaMarkt study [issue #78](https://github.com/Zennay/Supa/issues/78) remains OPEN, so no M4/M5 eligibility.

## Immutable source and QA ownership

- Frozen new product owner [DRAFT #2141](https://github.com/Zennay/Supa/pull/2141), exact SHA `7e27209e42443ac1a77cf0d34c11d9074d9e22d1`. Original owner branch, its tests and any parallel worker branch untouched.
- Independent QA frozen base `qa/frozen-m5-origin-fixed-7e27209e-20261013`; independent QA head `qa/m5-origin-six-original-postrepair-20261013`.
- Replayed file `tests/qa-m5-origin-six-unchanged-postrepair-20261013.test.mjs` is **byte-identical** to the original independent finding [DRAFT QA #2135](https://github.com/Zennay/Supa/pull/2135) `tests/qa-m5-origin-drift-priority-20261013.test.mjs`, original Git blob `070def9b787de88ae3c59abb38fda89fb27be895`. All six original expectations preserved; no fallback, changed assertions or rewriting expected severity.
- Only this new test and document added to frozen corrected owner source. No changes to source, other QA PRs, main, workflows, retailer samples, permissions, VPS, participant data or deployments.

## Acceptance

Two positives: identical ID + same supermarket/kind/snapshot remains `unchanged` with human P3 review; same-origin stable shape with changed snapshot SHA remains P2. Four previously RED: changing supermarket or capture kind despite identical hashes must *not* be classified unchanged and must drive **P1** human origin verification, with every rights/selector/production/M5 flag false. Synthetic fixtures only; source drift risk is a pure data identity protocol, not a real supermarket incident.

Exact HEAD hosted workflow must prove original six tests turn GREEN without weakening QA while npm ci/high npm audit, all project Node tests, M1 matching benchmark and source permission gate, TS/Vite build also pass. Any permanent VPS, latest-main integration and independent zCloud claim/lease/review/human release gate must be reported separately; hosted all-green does **not** authorize M4, M5, retailer scraping, claims or deployment.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.**
