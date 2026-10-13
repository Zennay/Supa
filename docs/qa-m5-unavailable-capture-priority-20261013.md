# Independent synthetic QA — missing-baseline / newly-added capture failure priority

**Date:** 2026-10-13. New issue [#2144](https://github.com/Zennay/Supa/issues/2144) on frozen earlier corrected product source [DRAFT #2141](https://github.com/Zennay/Supa/pull/2141) SHA `7e27209e42443ac1a77cf0d34c11d9074d9e22d1`. Independent QA source base `qa/frozen-m5-unavailable-priority-7e27209e-20261013`; test branch `qa/m5-first-capture-unavailable-priority-20261013`. Exactly two new QA test/docs paths, no alteration to original comparator, queue, original QA [#2143](https://github.com/Zennay/Supa/pull/2143), other workers, workflows or main.

## Source-derived trust/priority gap

Canonical `captureShape` emits `captureStatus=unavailable` and null hashes for failed inspections. But the original `compareInspections` checks `!baseline` -> `baseline_missing` and `!previous` -> `added` **before** inspecting current capture failure. Thus a new failed capture silently receives P2 instead of P1 human recapture/investigation, and a first failed source with no baseline yields `driftCount=0`. These are fully fictional in-memory inspections; not live retail source incidents, security violations, savings, permissions or user evidence.

Seven executable tests:
- Three positive controls: verified first baseline P2, verified new source P2, failed existing/known source P1;
- Four **expected RED** cases: failed no-baseline P1, failed no-baseline drift=1, newly added failed source P1, and mixed new verified+failed source ordering P1->P2->P3 rather than P2->P2->P3. No weakened output rights, eligibility, sources, tokens or raw identities.

Original source owners of future M5 capture comparer [#2108](https://github.com/Zennay/Supa/pull/2108) and review queue [#2126](https://github.com/Zennay/Supa/pull/2126) should design a fail-closed missing/added unavailable policy, retaining human approvals and explicit baseline flags, and independently replay the unchanged QA on their fix. Scope is **quality-validation only**; do not take over product-core owner runtime or automatically enable adapters.

Exact frozen QA HEAD CI should yield 3 positive PASS and 4 intended RED with no unrelated regressions. npm ci/high audit may pass but other M1/build steps **cannot** be claimed if unit RED stops the workflow. Permanent VPS, latest-main integration, zCloud independent preflight/write lease, owner review and explicit human releasego remain separate.

**M3 ACTIVE**; genuine human [PLUS + DekaMarkt 11+11 same-demand #78](https://github.com/Zennay/Supa/issues/78) OPEN. M4/M5 ineligible, no real data or claims. **DRAFT/HOLD/NO MERGE/NO DEPLOY.**
