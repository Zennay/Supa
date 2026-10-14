# M5 offline capture origin drift: conservative human review

**Milestone boundary:** SUPA remains **M3 ACTIVE**; genuine human 11+11 same-demand PLUS + DekaMarkt basket evidence [#78](https://github.com/Zennay/Supa/issues/78) remains missing. No M4/M5 operational eligibility, scraping, price observations, source rights, production rollout or savings claims.

## Scope and provenance

- Original M5 product sources: frozen [DRAFT #2131](https://github.com/Zennay/Supa/pull/2131) HEAD `e3b88649aa898d2a17153954135e5770bebc77a9`, itself stacked on [#2126](https://github.com/Zennay/Supa/pull/2126) and [#2108](https://github.com/Zennay/Supa/pull/2108).
- Independent issue [#2134](https://github.com/Zennay/Supa/issues/2134) and expected-RED [QA #2135](https://github.com/Zennay/Supa/pull/2135), original SHA `55c957002ee9d82a23357f8c96d098c20696acad`. Original QA suite's **six tests copied byte-for-byte** into a new product-only test path; original source-owner/QA/main/workflows untouched.
- Product correction adds `origin_changed` to the synthetic capture comparer when a stable ID is reassigned to a different `supermarket` or `kind`, **before** hashing/availability comparisons. Review queue maps this status to **P1 `investigate_source_origin_change`**, never automatic approval. Drift counters include this state.
- Direct pure review queue rejects a forged low-priority `unchanged` (or another false state) when supplied current/baseline origins differ, or a forged `origin_changed` where they are the same. Output remains opaque hashed source tokens, with `selectorVerified`, `rightsVerified`, `productionReady`, `m5Eligible` all false.
- Four supplemental in-memory tests exercise same-origin unchanged/P2, supermarket and kind P1, failed capture P1, forged statuses and stable sort. All data is imaginary and local.

## Offline regression command

```sh
node --test tests/m5-capture-signature-compare.test.mjs tests/m5-selector-review-queue.test.mjs tests/product-m5-origin-drift-qa-postrepair-20261013.test.mjs tests/product-m5-origin-drift-guardrails-20261013.test.mjs
npm test
npm run build
```

This status is only an **internal manual review task**, not a verified new supermarket, approved data source, legitimate selector or permission. Even if tests pass, M5 remains gated by M3 + M4 evidence and independent source/legal approval.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until original product + QA owner review, independent zCloud work-claim/write lease, exact-head hosted and applicable permanent VPS checks, latest-main integrated proof and explicit human release authorization.
