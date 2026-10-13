# Independent QA — offline M5 source-origin drift (#2134)

## Frozen source
Independent source: [DRAFT product #2131](https://github.com/Zennay/Supa/pull/2131), exact immutable `e3b88649aa898d2a17153954135e5770bebc77a9`, containing corrected M5 provenance metadata validation but **no change to existing capture-signature comparer**. QA-only base `qa/frozen-m5-origin-e3b88649-20261013`, test file `tests/qa-m5-origin-drift-priority-20261013.test.mjs`, plus this documentation. All source, other owner files, old QA suites, workflow and main unchanged.

## Independent input-identity invariant

`captureShape()` returns `id`, `supermarket`, `kind`, hashes and `schemaOrgStatus`; `compareInspections()` currently calculates drift only using checksums/schema status for a given ID. If someone reuses `fictional-source` at another fictional market or changes `kind=product` to `kind=category` while preserving the HTML snapshot hash, the comparison outputs `unchanged`. Downstream `buildOfflineSelectorReviewQueue()` makes this a **P3** routine review, hiding a relevant source-origin change. This is fully synthetic source-derived protocol QA, no demonstrated attack, live captures, malicious retailer action, saved prices or permission.

Six independently executable cases: two GREEN controls for truly identical origin+snapshot (P3 manual only) and same-origin snapshot change (P2 human review). Four expected RED cases: store-origin change must not be unchanged; kind change must not be unchanged; store-origin and kind drift must not reach P3 but require P1 human verification or another explicitly reviewed conservative classification. In all outcomes `m5Eligible=false`, `productionReady=false`, `rightsVerified=false`, `selectorVerified=false`, no public savings.

## Release and ownership

The owner of `scripts/m5-compare-capture-signatures.mjs` should define/fix the source identity drift policy, and the review queue owner should support the resulting human-review action without automatic reuse. Original code and QA assertions remain untouched. Exact frozen-head hosted CI is expected to report four intended RED and two positives; these intentional failures do **not** establish that benchmark/build passed. A future separately owned source fix requires an independent byte-identical replay with six GREEN, plus complete hosted/applicable permanent VPS, zCloud write lease/preflight, latest-main and explicit human release approval.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.** SUPA is still M3 ACTIVE; genuine human 11+11 PLUS+DekaMarkt [M3 #78](https://github.com/Zennay/Supa/issues/78) OPEN, M4/M5 not eligible. Never infer real rights, production selectors or savings claims from these fictional fixtures.
