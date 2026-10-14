# SUPA — canonical inspected HTML signals in private M5 review (14 October 2026)

## Scope and evidence
M3 remains the only active phase. Real human PLUS 11 + DekaMarkt 11 same-demand observations within 24 hours under [#78](https://github.com/Zennay/Supa/issues/78) are missing; neither M4 nor M5 may start. This is entirely offline future-M5 privacy/trust preparation under [issue #2257](https://github.com/Zennay/Supa/issues/2257), not prices, selectors, retailer access, permission, beta or savings proof.

The downstream pure `buildOfflineSelectorReviewQueue()` previously admitted verified captures declaring malformed or entirely absent `hasNextData`, `jsonLdCount`, and `jsonLdParseErrors`, even though the upstream M1 HTML inspector and M5 `captureShape()` always produce all three for a verified capture. A fabricated inspection could claim more JSON-LD parse errors than extracted records and still be presented to a human as apparently reviewable P1/P3. Conversely, an unavailable capture could carry these successful-inspection signals, which canonical M1 never emits.

## Isolated product correction
Frozen parent product [DRAFT #2252](https://github.com/Zennay/Supa/pull/2252) exact hosted-green `1b2dbf2b9eb2587c1892e1bd10cd32d9c429a228`, independent product-core branch. Original #2252, all independent quality-validation workers/branches, M1, M3, UI, main, workflows, permanent VPS and user/retailer data remain untouched.

- Verified snapshot requires own `hasNextData` boolean, own safe integer `jsonLdCount` in [0,128], and own safe integer `jsonLdParseErrors` in [0,jsonLdCount]. No strings, coercion, missing, inherited, nonfinite, fractional or negative numbers.
- Unavailable snapshot may not include any of those three successful-inspection fields.
- Same source/origin and identical SHA-256 verified HTML must have equal flags/counts across the two sides, in addition to the existing shape/Schema.org invariants.
- Reject with one existing source-independent `Invalid offline capture comparison report` error, preserving source token privacy, input immutability, P1/P2/P3 legitimate review, 100+100 union and all release/rights/production flags false.

## Reproduction and validation
New `tests/product-m5-inspection-signal-contract-20261014.test.mjs` contains 14 synthetic product tests covering missing/malformed/oversized counts, parse-error bounds, 128 limit, false successful metadata on unavailable, same-HTML contradictions, true P1/P2/P3, 100+100 valid union and actual `inspectHtml()` → SHA-256 → `compareInspections()` → review queue roundtrip.

The **first exact-head [hosted CI #38505368903](https://github.com/Zennay/Supa/actions/runs/38505368903)** executed 973 tests, **940 PASS / 33 FAIL**, with the failures confined to seven pre-existing synthetic fixture-helper files that fabricated verified snapshots without the upstream M1-mandatory three inspection fields. The new 14-case product suite, including the real `inspectHtml()` roundtrip, passed. The canonical validation has **not** been relaxed: precisely seven previous test-fixture constructors on this isolated child now add `hasNextData:false, jsonLdCount:0, jsonLdParseErrors:0` to their fictional verified snapshots; unavailable snapshots remain without these fields. No existing assertions changed and original source or independent QA branches are untouched. This is a valid synthetic empty-JSON-LD M1 shape; the full exact-head CI must be repeated and verified before claiming success. Require `npm test`, audit high, M1 matching/source permission and TypeScript/Vite production build.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until verified zCloud SQLite scope/task write lease, original source+QA owners, full exact-head CI plus latest-main/trusted runner where applicable, genuine #78 field evidence and explicit human release authorization.
