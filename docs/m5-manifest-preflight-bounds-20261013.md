# Offline future-M5 capture manifest preflight — before M1 file traversal

## Current stage and boundaries
Supa remains **M3 ACTIVE**. The genuine 11-line PLUS baseline and 11-line DekaMarkt candidate human same-demand observation within 24 hours and a single price context [#78](https://github.com/Zennay/Supa/issues/78) is still outstanding. No M4 beta, M5 production, retailer permissions or pricing claims are authorized.

This isolated product-core child of frozen, corrected [DRAFT #2157](https://github.com/Zennay/Supa/pull/2157), immutable `1d0cd82365cd96c120ccddcc55297f280d80819e`, changes **only the M5 wrapper**, not the canonical M1 inspector or real capture/retailer pipeline. Original owners, QA workers, other branches, main, workflows and live data untouched.

## Problem and correction
`compareInspections()` limited a prepared `sources` array to 100, but `compareCaptureDirectories()` first invoked `inspectCaptureDirectory()`, which reads and iterates every capture in its manifest. An oversized untrusted manifest could thus trigger excessive local HTML processing before M5's own limit rejected the resulting inspection.

A separate `preflightBoundedManifest()` now checks **both current and optional baseline manifest files before either M1 source HTML read**:
- Existing regular file, size at most **8 MiB**, with a second post-read byte check.
- Parseable JSON declaring `milestone: "M1 Data Feasibility"`, explicit `bounded: true`, an array of at most **100** results, and matching `sourceCount`.
- Reject missing, oversized, mismatched and malformed records via generic non-identifying `Invalid or oversized M1 capture manifest`.
- Valid captures still pass to unchanged `inspectCaptureDirectory()` and its SHA and permission checks; no feature flags or M5 eligibility altered. A failed first capture remains P1 human investigation, never production/rights approval.
- **Not a race-proof atomic filesystem snapshot:** manifest metadata can change between the preflight and canonical M1 reread. A stronger transaction would require a separately reviewed M1 input-buffer/pinned-file API. Do not cite this preflight as TOCTOU protection.

## Tests
```sh
node --test tests/product-m5-manifest-preflight-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```
Five entirely synthetic local tests: real failed-capture → manual-only P1; 101 result entries rejected before non-existent source HTML; oversized baseline rejected before reading current HTML; malformed, mislabeled, absent and mismatched metadata rejected with no writes; and >8 MiB JSON refused. No HTTP, private participants, actual grocery prices or rights claims.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud preflight/claim/write lease, original source/QA owner review, exact-head hosted and applicable permanent VPS validation, latest-main integrated proof, authentic M3 field and explicit human release go.
