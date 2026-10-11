# SUPA product-core · exact M3 field observation clock (2026-10-11)

## Active product gate
M3 full-basket comparison and observed savings remains **ACTIVE**. This code change addresses the independently reproduced boundary #1513: both sides of a genuinely observed weekly comparison must lie inside one inclusive clock window, even when supplied ISO 8601 timestamps carry 4–9 fractional digits. The real PLUS/DekaMarkt 11-demand field pair #78 is still required; no synthetic fixture is retailer evidence.

## Narrow implementation
- New `src/domain/m3ObservationClock.ts`: validates UTC/offset ISO clock and real calendar date, preserves 1–9 digit fractions as exact epoch nanoseconds, calculates hours limits using decimal integer ratios, and normalizes exact UTC timestamps/deadlines without discarding nanoseconds. Approximate hours are **presentation only**.
- `src/domain/observedBasketStudy.ts`: financial claimability uses the exact interval, not `Date.parse` rounding. An invalid or >limit pair yields `claimable=false`, `unknown`, `deltaCents=null`, `savingsCents=null` and empty `lineDeltas`. Existing exact-limit, worse and unknown semantics remain.
- `src/domain/m3ObservationSheet.ts`: collector validity, complete-sheet readiness, within/outside status and first-observation deadline use the same exact clock. The UI retains `.000Z` for whole-millisecond timestamps and full 9-digit precision when finer fractions are present.
- New product-core acceptance tests exercise exact +1ns/+999999ns rejection, −1ns acceptance, reverse order, DST/UTC offsets/leap day, invalid timestamps, 15m/1h/90m and fractional-hour thresholds, collector draft restoration and display preservation, full synthetic two-store financial assessment. **No retailer product source, price, offer, license or consent changes.**

## Acceptance and release
1. Exact final branch HEAD: pinned hosted CI (`npm ci`, audit, full tests, benchmark, source-permission check, TypeScript/Vite build). Applicable permanently self-hosted VPS/mobile/Firefox/M3 workflow proof must also bind this exact head.
2. Preserve normal whole-second/millisecond and trailing-zero 1–9-digit timestamps. Valid 24h−1ns stays accepted; 24h+1ns refuses every public financial claim path.
3. Retain private participantKey exclusion, negative savings/worse outcomes, missing-data uncertainty. No observation is synthesized and no claim of real savings is made.
4. Original domain/QA owner clock policy approval, verified zCloud owner/lease and latest-main safe integration are mandatory. Independent safety acceptance [#1513](https://github.com/Zennay/Supa/issues/1513) must be independently replayed against this branch.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until all acceptance gates pass. In addition to human [#78](https://github.com/Zennay/Supa/issues/78), independent mutable cross-basket [#1508](https://github.com/Zennay/Supa/issues/1508) remains unresolved and is not modified by this fix.
