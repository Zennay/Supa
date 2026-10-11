# SUPA M3 observation clock precision — independent QA acceptance matrix

**Status: proposed QA contract / expected RED / not a source fix or release decision.**
**Reproducible issue:** [#1513](https://github.com/Zennay/Supa/issues/1513). Canonical `main` at test creation: `22edb59b7c96311b686161b74a9fc2060e3c5d77`.

## Trust boundary in the running product

The M3 collection UI exposes two independent signals from `src/domain/m3ObservationSheet.ts`:

1. `observationWindowSummary(sheet)`: within/outside 24h status, including what deadline is shown after the first entry.
2. `observationSheetReadiness(sheet)`: whether a full two-store collection is ready for export.

The converter (script `m3-build-observed-study.mjs`), `assessWeeklyBasketStudy` and `buildObservedWeekReport` form later gates, covered separately in [draft RED #1512](https://github.com/Zennay/Supa/pull/1512).

**Financial integrity requirement:** if any layer admits an exact instant with fractional seconds, no earlier collection signal may classify **24h + 1ns** as within-window merely because JavaScript `Date.parse` truncates to millisecond resolution. An export-ready collection display is a workflow cue, **not** an observed savings claim.

## Executable test coverage

- `tests/qa-m3-collector-submillisecond-window-red.test.mjs`: independent `BigInt` UTC nanosecond oracle (fractional digits 1–9, offsets interpreted at whole-second precision); UTC forward, UTC inverse and DST +02→+01 strict 24h+1ns violations; exact 24h, exactly valid 24h across DST, 24h−1ns, conventional 24h+1ms positive/negative controls.
- `tests/qa-m3-collector-persisted-fractional-window-red.test.mjs`: starts from the canonical sheet, serializes the v1 draft with `JSON.stringify`, restores through `restoreObservationSheetDraft`, verifies the 24h cap and exact original timestamps survive, and rechecks both collector signals. Controls retain valid exact-24h and reject +1ms.

Each synthetic sheet explicitly records both store names, pseudonymous identifiers and all 22 items as **unavailable**; it does **not** fabricate product prices, receipts, consent, actual retailer observations, savings or source-usage permission.

| Exact elapsed time | Expected collector window | Expected readiness | Why |
|---|---|---|---|
| 24h+1ns, UTC | outside | false | Strict maximum breached despite millisecond truncation |
| 24h+1ns, inverse store observation order | outside | false | Order must not weaken the elapsed-time rule |
| 24h+1ns, +02:00 to +01:00 over DST | outside | false | Elapsed UTC, not wall-clock hours |
| 24h+1ns, persisted/restored draft | outside | false | Reopening the browser must not reclassify evidence |
| Exactly 24h, 9 trailing zero digits | within | true (other metadata complete) | Documented inclusive maximum |
| 24h−1ns, 9 digits | within, if supported | true (other metadata complete) | Do not reject genuinely in-window evidence under exact-nanosecond implementation |
| Exactly 24h, offset-normalized DST | within | true (other metadata complete) | Equivalent UTC instants |
| 24h+1ms | outside | false | Existing millisecond-support control |

## Source-owner policy to choose before any fix

**Policy A (precise):** compare parsed instants as integer UTC nanoseconds; preserve exactly representable 1–9 digit fractions and enforce the inclusive `<= 86_400_000_000_000ns` window across collector, converter, assessment and report. Expose a deadline that is not silently rounded in a way that overstates eligible collection time.

**Policy B (conservative):** reject nonzero precision beyond supported milliseconds *consistently* across all ingestion, draft restore, collector readiness, converter and report boundaries. Under this policy the near-boundary submillisecond-positive test expectations must be explicitly updated **only with independent owner approval**; never silently relax negative rejection cases to make CI green. Nine-digit **trailing-zero** encodings representing exact millisecond instants remain legitimate.

Either policy must keep unrelated incomplete/invalid basket comparisons unknown with null delta/savings and `publicSavingsClaimEligible=false`; source catalog freshness [#1148](https://github.com/Zennay/Supa/issues/1148) and adversarial cross-basket atomicity [#1508](https://github.com/Zennay/Supa/issues/1508) are separate owner paths.

## Release checklist

1. Obtain zCloud coordination preflight, verified write claim/lease and original source-owner policy decision; no unauthorized edit to overlapping source.
2. Keep immutable expected-RED proof with exact SHA, failure count and all positive controls passing.
3. Land a *separate* reviewed implementation against then-current main; rerun both collector and report/converter suites independent GREEN on the exact source SHA, including permanently hosted M3/VPS/Firefox where applicable.
4. Preserve synthetic evidence labeling and privacy; do not treat successful tests as permission to claim real PLUS→DekaMarkt savings.
5. Human [field study #78](https://github.com/Zennay/Supa/issues/78) remains a separate mandatory M3 exit gate, even after technical correction.
