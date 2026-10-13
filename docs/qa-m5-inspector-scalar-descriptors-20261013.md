# Supa independent M1 → M5 inspector descriptor QA (13 October 2026)

### Phase and ownership

Supa is **M3 ACTIVE**, genuine same-demand 11 PLUS / 11 DekaMarkt price observations in a single price context within 24 hours remain human-open [issue #78](https://github.com/Zennay/Supa/issues/78). M4/M5 are not eligible. All work here uses invented synthetic HTML/inspection data; no retailer/network, participant, rights or savings evidence.

New independent finding [#2152](https://github.com/Zennay/Supa/issues/2152) on frozen original product [DRAFT #2151](https://github.com/Zennay/Supa/pull/2151) SHA `df45c8dcb7c9a4430f889907f642ed90c82cab88`. Original product worker controls `scripts/m5-compare-capture-signatures.mjs`, so we change **only a new isolated QA test and this document** on own frozen QA branches; no owner source, existing QA, main, workflows or other workers modified.

### Canonical source contract

Real `scripts/m1-inspect-captures.mjs::inspectHtml()` emits booleans `hasNextData`, JSON-LD entries with string[] `type` and `keys` and optional **only true** `parseError`, plus `applicationJsonScripts[]` records with `id: string|null` and `bytes: nonnegative safe integer`. New #2151 bounds arrays but allows malformed scalar metadata: for example missing / string `hasNextData` maps to `false`, `parseError='true'` maps to `false`, and `applicationJsonScripts=[{}]` or an array descriptor is accepted. This can turn impossible inspected captures into the same `shapeSha256` and routine P3 unchanged review instead of a fail-closed error. **No actual source failure incident** asserted.

Eight independent executable tests: 3 positive (actual M1 HTML inspector descriptors, real parse-error=true P1 drift, canonical valid scripts) and 5 **intentional source-RED** (missing/wrong hasNextData, fake parseError value, missing/wrong script id or byte count, script array masquerading as object, negative/nonfinite/fractional/noninteger byte count). Invalid source must throw a generic non-leaking error without mutating input; valid captures remain manual-only `productionReady=false`, `m5Eligible=false`, `rightsVerified=false`, `selectorVerified=false`.

### Validation and hold

Run exact QA head hosted npm ci/high audit/all Node tests. Expect exactly 5 intended RED and 3 new positives, no unrelated regression. Later M1 benchmark/permission and build **cannot be claimed** on intentionally RED hosted workflow unless separately run. For corrected product: copy **unchanged** original test blob onto independently frozen new owner SHA and require 8/8 GREEN plus complete hosted+applicable permanent VPS, current-main, zCloud scope/preflight/write claim/lease and explicit original product+QA owner and human release approvals.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.** No release, retailer sources or M4/M5 activation.
