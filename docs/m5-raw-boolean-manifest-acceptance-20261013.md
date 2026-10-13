# M5 raw M1 manifest Boolean success preflight — #2159

## M3 source-of-truth / no-go
SUPA remains **M3 ACTIVE**. No genuine human same-demand 11-line PLUS baseline and 11-line DekaMarkt candidate observations have been collected ([#78](https://github.com/Zennay/Supa/issues/78)); M4/M5 remain ineligible. All tests here use synthetic, offline local manifests and made-up HTML SHA, no real prices/rights/retailer requests.

## Input provenance problem
Frozen [product #2157](https://github.com/Zennay/Supa/pull/2157) requires `typeof source.success === 'boolean'` in the pure future-M5 `captureShape`. However canonical existing `m1-inspect-captures.mjs` normalizes raw manifest `record.success = Boolean(result.success)`: an invented string `'false'` becomes a verified success when coupled with an otherwise matching fictional HTML+SHA; absent/null becomes unavailable. Independent [QA issue #2159](https://github.com/Zennay/Supa/issues/2159) identified that this bypasses the pure helper check and misclassifies human-review priority.

## Narrow independent product remedy
This DRAFT child extends the **M5-only** local `preflightBoundedManifest()` from frozen [DRAFT #2160](https://github.com/Zennay/Supa/pull/2160), exact source `3fb59f08f924a7624667e75a18b75499e049c759`, before invoking the **unchanged** M1 inspector:

- Every raw `results[]` entry must be an object declaring `success` **exactly `true` or `false`**. Missing, null, string, number, array or object flags raise the generic `Invalid or oversized M1 capture manifest` with no source names/paths.
- Applies to both current and optional baseline before any listed source HTML I/O. M1 bounds and high-level manifest schema checks remain unchanged.
- Canonical raw `true` with SHA-verified local HTML still becomes P2 human baseline review; raw `false` remains P1 unavailable/recapture. The queue remains fully `rightsVerified=false`, `selectorVerified=false`, `productionReady=false`, `m5Eligible=false`.
- As with parent #2160, this is **not an atomic or race-proof manifest snapshot**: M1 separately rereads the file. No change to upstream M1 or permission to crawl stores.

## Deterministic evidence
The **original six independent tests** from [QA #2161](https://github.com/Zennay/Supa/pull/2161), frozen QA source `963fccdbbface66e53783f18ab6ddb3c04cbfd24`, Git blob `e7b577f03590d93ccc11da4c7119f65b6ac3d73d`, were copied **byte-for-byte** into a new product-only path, leaving QA owner/branch unchanged. Original QA intentionally had four RED cases against #2157, with two positive CLI controls. Two supplemental tests cover malformed mixed manifests and baseline rejection before current missing HTML traversal.

```sh
node --test tests/product-m5-raw-manifest-original-qa-20261013.test.mjs tests/product-m5-raw-manifest-mixed-preflight-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

**DRAFT/HOLD/NO MERGE/NO DEPLOY**, pending exact-head hosted tests and applicable permanent VPS, independent zCloud preflight/write lease, original M1/M5 and QA owner agreement, latest-main integration, genuine M3 field #78 and explicit human release authorization.
