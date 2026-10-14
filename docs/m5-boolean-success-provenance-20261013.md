# Offline M5 source success flag — M1 boolean provenance

**Stage:** SUPA is **M3 ACTIVE**. The real 11-line PLUS baseline + 11-line DekaMarkt candidate study within one price context and 24h, [#78](https://github.com/Zennay/Supa/issues/78), has not been collected; M4/M5 cannot be activated. This document describes only an offline synthetic input contract.

## Source and correction

Frozen upstream [DRAFT #2154](https://github.com/Zennay/Supa/pull/2154) immutable `4e63910aa3eaabf5ce27c4aa5797c8223791752e`. This separate product-core child changes only the future-M5 signature compare entry point; original M1 parser, source owners, QA workers, main, workflows and any capture files remain untouched.

`m1-inspect-captures.mjs::inspectCaptureDirectory` emits a **boolean** `success` for every capture. The separate pure `captureShape(source)` accepted any truthy `source.success` as a successful capture if hashes and integrity fields looked verified, so a handcrafted string `'true'` could appear as `verified` / `unchanged` P3 instead of being rejected as noncanonical M1 provenance.

The corrected pure entry point requires `typeof source.success === 'boolean'` before unavailable/verified status logic. Any missing/string/numeric/object success is rejected with generic `Invalid inspected capture success` (no source ID or content in error). Genuine verified booleans retain original signature semantics; false booleans remain unavailable and P1 human review. No user-facing prices, rights/selector approval, M3 study observations, automated retailer requests or production effects.

## Tests

```sh
node --test tests/product-m5-boolean-inspection-success-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

Four synthetic cases: valid verified/unchanged P3 manual review with release flags false; failed/first unavailable P1; spoofed `'true'`, `'false'`, numeric, boxed, missing values rejected without mutating inputs; and **actual M1 directory inspector** on a local SHA-verified, fictitious HTML capture yields a true boolean and unchanged offline comparison without network activity. Real M1 manifest parsing/coercion is unchanged and is a separate upstream provenance decision; this fix validates only the exported pure M5 input.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud scope/write lease, product/QA owner review, exact hosted+applicable permanent VPS evidence, current-main integrated acceptance, authentic M3 field collection and explicit human release authorization.
