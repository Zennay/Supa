# M5 offline first/new unavailable captures — P1 human review (13 October 2026)

**Current stage remains M3 ACTIVE.** Genuine 11+11 manual PLUS + DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) observation has not been completed. None of this is real price/source evidence, M4/M5 eligibility, live retailer access or a permission decision.

## Origin and scope
- Separate product-core child of corrected source [DRAFT #2141](https://github.com/Zennay/Supa/pull/2141) immutable parent `3de47ea61749a09cf1ce9fa612200e04c3004bf1`. Original owner branches, independent expected-RED [QA #2145](https://github.com/Zennay/Supa/pull/2145), `main` and workflows remain untouched.
- Addresses source-derived [issue #2144](https://github.com/Zennay/Supa/issues/2144): `compareInspections` previously labelled an **unavailable first capture** (no baseline) `baseline_missing` (P2, drift 0) or an **unavailable newly added source** `added` (P2), hiding the actual acquisition failure.
- Unavailable current captures now take precedence over missing/added baselines: explicit `unavailable` P1 `recapture_or_investigate_failure`, counted as drift even when baseline absent.
- Legitimate verified first capture remains `baseline_missing` P2; verified new source `added` P2; known original with failed current P1; disappeared entire source `removed` P1.
- Queue verifier permits `unavailable` with no same-ID baseline only for a truly unavailable current snapshot; refuses fabricated `added` or `baseline_missing` statuses for a failed capture. Every result remains human-only and `selectorVerified=false`, `rightsVerified=false`, `productionReady=false`, `m5Eligible=false`.
- Seven original synthetic independent acceptance cases are copied **byte-for-byte** from frozen [QA #2145](https://github.com/Zennay/Supa/pull/2145) into a new product-only replay path. Three extra tests validate forged status rejection, mixed existing/new sources and an actual offline CLI on an intentionally failed fictional M1 manifest, with no live HTTP, credentials, retailer or personal data.

## Reproducible offline checks

```sh
node --test tests/m5-capture-signature-compare.test.mjs tests/m5-selector-review-queue.test.mjs tests/product-m5-unavailable-first-capture-qa-replay-20261013.test.mjs tests/product-m5-unavailable-capture-priority-guardrails-20261013.test.mjs
npm test
npm run build
```

This is **review priority hardening**, not evidence that any private source can be ingested. External use, legal/licence and M3/M4 go/no-go gates remain separate and closed.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud work-claim/lease, original product and QA review, exact-head hosted + applicable permanent VPS checks, current-main integration and explicit human release authorization.
