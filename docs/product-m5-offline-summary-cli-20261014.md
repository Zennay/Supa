# SUPA — aggregate-only private M5 human review CLI (14 October 2026)

**Scope and phase:** Future M5 **offline preparatory draft**. Supa remains **M3 ACTIVE**. Actual human [issue #78](https://github.com/Zennay/Supa/issues/78) must establish one real 11-line PLUS baseline and 11-line DekaMarkt same-demand basket observation within 24 hours in the same price context, even if Supa finds no savings. M4/M5 are ineligible. No real store HTML, selectors, permissions, user data or pricing was accessed.

## Operator command and output
Frozen existing human-only CLI remains unchanged by default:

```sh
node scripts/m5-build-selector-review-queue.mjs <current-M1-dir> [historical-M1-dir]
```

For a privacy-minimal workload overview without even opaque per-source tokens, opt in to:

```sh
node scripts/m5-build-selector-review-queue.mjs --summary-only <current-M1-dir> [historical-M1-dir]
```

The optional flag must occur in **first position**. Incorrect or extra CLI flags, missing paths, malformed captures or failed SHA verification are rejected, emit **no stdout**, use one generic source/path-private stderr line and exit unsuccessfully. Validation of whole private M1 manifests, HTML SHA evidence and the entire future M5 queue is performed **before** any summary is emitted; no partial work can become an accepted summary. A genuine no-baseline current capture produces a P2 source-baseline task; an independent earlier matching capture produces P3; structural drift yields P1. The emitted summary JSON contains only `contractVersion`, special `mode: offline_selector_review_summary_only`, `inputContract`, `baselineProvided`, validated `sourceCount`, `driftCount`, derived `summary.actionCount / priorityCounts / statusCounts` and explicit manual-only false release/rights/selector flags. **No `actions` or `sourceToken` keys** are emitted.

## Evidence and safety
Isolated [issue #2267](https://github.com/Zennay/Supa/issues/2267) and separate product-core child of immutable hosted-green [product draft #2264](https://github.com/Zennay/Supa/pull/2264), commit `e4e803fab5da859915ec8921f15defab34192c64`, 981/981 synthetic tests passing on the parent. Exact child paths: the existing CLI M5 queue file, one new six-test real **locally generated imaginary** M1 HTML capture + manifest CLI acceptance file, and this document. Independent summary QA [#2266](https://github.com/Zennay/Supa/pull/2266), original product owner branches, M1, M3, planner, UI, main, workflows, VPS, users and actual retailers remain untouched.

The six additional tests use temporary isolated M1 folders and SHA-256 verified invented HTML, cover first capture P2, independent historical P3, real structural-drift P1, tampered SHA fail-closed with generic stderr, invalid flag/path arrangements, empty M1 cohort explicit zero totals, summary-vs-default backward compatibility and redaction/no individual source tokens. No network or real prices. Verify **exact child head** GitHub-hosted npm ci, all tests, high audit, M1 matching benchmark and source-permission checks, and TypeScript/Vite production build before claiming success.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently confirmed zCloud SQLite scope/task claim+lease, original product+QA owner review, exact hosted evidence and appropriate latest-main/trusted VPS integration, genuine human M3 field proof, explicit releasego. This CLI is not an invitation to collect retailer data without authorization.
