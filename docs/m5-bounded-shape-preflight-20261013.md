# M5 capture-shape resource bounds (offline preparation, 13 Oct 2026)

**SUPA M3 ACTIVE:** real, same-demand 11-line PLUS + DekaMarkt manual observations [#78](https://github.com/Zennay/Supa/issues/78) remain missing. This work is synthetic, does not enable M4/M5, request retailer pages, collect prices, approve source rights or imply savings.

## Problem and scope
`captureShape()` hashes structural JSON-LD types/keys from the M1 inspector. The previously unbounded nested `jsonLd`, `applicationJsonScripts`, and record `type`/`keys` arrays could require disproportionate processing or silently discard malformed/sparse records into an apparently unchanged signature, even while only the top-level source count was bounded.

This **separate product-core DRAFT child** starts from frozen hosted-green [#2149](https://github.com/Zennay/Supa/pull/2149) exact commit `9d6eb014fc10f6ff133c37a59f61533e9670d21c`. Original product, QA, other worker branches, main, workflows and actual captures remain untouched.

## Correction
- Require at most **128 JSON-LD records** and **128 application/json script descriptors** per inspected capture.
- Require canonical dense JSON-LD records with `type` and `keys` arrays of at most **256 strings each**, every string at most **256 UTF-16 units**. No sparse arrays, null records or invented non-string terms.
- Reject invalid/sparse script descriptor collections before fingerprinting. Fail closed with one generic message `Invalid or unbounded inspected HTML shape` that never reflects input values.
- Preserve comparison semantics for valid inspected M1 structures, legitimate unknown schema terms being ignored by the original type/key allowlists, exact-origin P1, failed-first-source P1, and `rightsVerified/selectorVerified/productionReady/m5Eligible=false`.
- All limits are protective conservative future-M5 review constraints, **not** evidence of an actual oversized retailer response. If a genuine future source reaches a bound, it requires human review, not silent truncation or automatic ingestion.

## Evidence

```sh
node --test tests/product-m5-bounded-shape-inputs-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

Four synthetic tests exercise exact-bound normal data, oversized JSON-LD/scripts and types/keys, missing or sparse input, immutable capture objects and the real offline CLI refusing a SHA-verified fictional 129-block HTML snapshot without stdout or private path/URL diagnostics.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud write lease/preflight, original source + QA owners, exact-head hosted and applicable permanent VPS, latest-main integrated proof, real M3 field #78 and explicit human release go.
