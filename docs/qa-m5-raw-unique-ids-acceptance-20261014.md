# SUPA independent M5 raw-ID preflight acceptance — 14 October 2026

## Frozen source and parallel boundary

Supa stays **M3 ACTIVE**. M1/M2 are technically complete, but genuine same-demand human [PLUS 11 and DekaMarkt 11 observations #78](https://github.com/Zennay/Supa/issues/78) within 24 hours remain OPEN; M4/M5 execution, retailer rights and savings claims are not authorized.

Latest isolated [product DRAFT #2200](https://github.com/Zennay/Supa/pull/2200), exact source SHA 1ce6bec0385f730554b4e9ee3e1177a524677fca, contains raw canonical/unique M1 source-ID preflight and nofollow descriptor-bound manifest reading. This QA-only branch adds eight independent synthetic acceptance tests and a provenance note. No product, main, original QA, workflows, permanent VPS, retailer data or other worker changes.

## Strict acceptance matrix

- Two distinct canonical IDs with SHA-verified tiny local HTML remain P2 private/manual-only. The same IDs ACROSS two physically distinct chronological captures remain P3 private/manual-only; selector, rights, production and M5 flags remain false.
- Duplicate source ID within the CURRENT cohort across success and failure, across two supermarkets, and among entirely unsuccessful/P1 rows must be rejected during raw manifest preflight.
- Duplicate source ID in HISTORICAL cohort must also be rejected before attempting to read intentionally missing current HTML.
- Invalid path IDs within CURRENT or HISTORICAL raw manifest must be rejected as structural manifest errors before any successful-source HTML lookup.
- Every negative case asserts exact direct comparator error 'Invalid or oversized M1 capture manifest', normally exited CLI with NO JSON stdout and generic private stderr, untouched input manifests. A later duplicate rejection or incidental ENOENT is insufficient. All data uses invented example.invalid URLs and local synthetic SHA content, no retail network or real prices.

Separate [open issue #2201](https://github.com/Zennay/Supa/issues/2201) concerns raw supermarket/kind origin validation before HTML reads and is product-core owned, not this QA scope.

Require exact-head hosted npm ci, high audit, full Node tests, M1 matching/source-permission gate and TS/Vite build. Green synthetic results are not a race-free filesystem snapshot, current-main/VPS deploy approval, M3 exit or M4/M5 eligibility.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite task/write preflight and claim lease, original product/QA owner reviews, safe latest-main/applicable trusted permanent VPS integration, real human field evidence and explicit releasego.
