# M5 offline canonical HTML inspection scalar validation — 2026-10-13

## Scope
Supa is **M3 ACTIVE**. Genuine same-demand 11× PLUS and 11× DekaMarkt observations in the same price context within 24 hours are missing ([#78](https://github.com/Zennay/Supa/issues/78)). This is future-M5 *offline* input trust hardening, not retailer access, savings evidence or eligibility.

Source owner [DRAFT #2151](https://github.com/Zennay/Supa/pull/2151) immutable snapshot `df45c8dcb7c9a4430f889907f642ed90c82cab88`; new child **product-core-only** branch. Independent QA finding [#2152](https://github.com/Zennay/Supa/issues/2152) detected scalar shape metadata that was accepted or silently downgraded even though `scripts/m1-inspect-captures.mjs::inspectHtml` cannot generate it.

## Canonical M1 fields
- `hasNextData` is an **explicit boolean**. No missing or string/number fallback to `false`.
- Each `jsonLd[]` record has dense bounded `type[]` and `keys[]` string arrays; its `parseError` is either *absent* or exactly `true`, never `false` or arbitrary truthy values.
- Every `applicationJsonScripts[]` item is a non-array object with its **own** `id` (string or null) and **own** `bytes` (nonnegative safe integer). Missing, inherited, nonfinite, fractional or negative descriptors fail closed.
- Existing caps 128 JSON-LD records / 128 application JSON scripts / 256 bounded strings are retained; no truncation, source substitutions or altered snapshot hash calculations. Invalid scalar metadata fails before comparison, using a generic non-leaking error.
- Previous conservative manual review remains: origin changes P1, capture failures P1, unavailable baseline P1; review rights, selectors, production and M5 eligibility remain false.

## Synthetic acceptance
`tests/product-m5-canonical-shape-scalars-20261013.test.mjs` (five groups) uses the **actual** `inspectHtml` M1 parser as a positive control and tests false/missing `hasNextData`, forged `parseError`, missing/invalid `application/json` script descriptions, SHA integrity priority, failed capture P1, immutability and opaque human-only queue output. All offline, no real retailer credentials, prices, requests, customer data or M3 evidence.

```sh
node --test tests/product-m5-canonical-shape-scalars-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud scope claim/lease/preflight, original source and independent QA owner review, exact-head hosted and applicable permanent VPS, current-main integrated acceptance, authentic M3 #78 and explicit human release go.
