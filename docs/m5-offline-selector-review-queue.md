# M5 preparation: offline selector-review queue

**Milestone posture:** SUPA remains **M3 ACTIVE**. The genuine same-demand PLUS + DekaMarkt field observation in #78 has not been captured; M4 and M5 execution remain ineligible. This is an isolated, synthetic/offline product-core candidate for PWQ-317 / epic #2069, built on the frozen source of draft #2108.

## Purpose and run

Translate a verified M1 capture-signature comparison into a deterministic **human review queue** for potential future adapters. This does not extract CSS selectors, certify JSON paths, fetch any retailer, enable a feed or grant reuse rights.

```bash
node --experimental-strip-types scripts/m5-build-selector-review-queue.mjs <new-M1-capture-dir> [old-M1-capture-dir]
node --test tests/m5-selector-review-queue.test.mjs
```

The script delegates SHA verification to `m5-compare-capture-signatures.mjs` -> existing M1 inspector, then emits JSON to stdout. No file writes or network requests. Local operator must supply trusted, authorized capture directories; this inherits the parent inspector's path-trust limitations.

## Review semantics

| Upstream status | Priority | Human next action |
|---|---|---|
| `removed` | P1 | Investigate missing source |
| `unavailable` | P1 | Investigate failed capture or recollect only where approved |
| `shape_changed` | P1 | Review parser and selector drift against authorized capture |
| `added` | P2 | Review new source and retailer rights |
| `baseline_missing` | P2 | Establish an authorized baseline |
| `content_changed_shape_stable` | P2 | Review content and extraction; shape similarity is not selector proof |
| `unchanged` | P3 | Review selectors manually before any operational reuse |

Output contains deterministic SHA-256 source tokens rather than raw IDs, prices, URLs, HTML or PII. It rejects forged ready/eligible flags, inconsistent counts, impossible status/snapshot combinations, invalid integrity hashes, duplicate IDs and oversized reports. Queue priority orders human work only; it does not order automated network activity. Every action has `selectorVerified=false`, `rightsVerified=false`, `productionEnabled=false`; overall report is **always not production ready / not M5 eligible**.

## Release gates

Do not merge or deploy this isolated draft before zCloud write lease, exact-head hosted CI, applicable permanent VPS validation, source-owner review, latest-main integration, and explicit human authorization. No collection/recruitment, public savings claim, live scraping, proxy rotation, or retailer production use is authorized by this review report. Genuine M3 issue #78 remains open.
