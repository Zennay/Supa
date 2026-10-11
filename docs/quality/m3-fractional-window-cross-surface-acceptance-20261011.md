# SUPA M3: fractional field-window cross-surface acceptance

**Scope:** independent quality-validation expansion of [#1513](https://github.com/Zennay/Supa/issues/1513) and existing [DRAFT #1516](https://github.com/Zennay/Supa/pull/1516). **HOLD / expected RED / no source repair, merge, deploy or retailer claim.**

## Reproducible additional impact

The source code accepts ISO instants containing 1–9 fractional digits, yet its `Date.parse` elapsed-time comparisons drop precision beyond the millisecond. The existing owner QA already proves **24h + 1 nanosecond**. This independent extension demonstrates the false-positive window is **as wide as 999,999 nanoseconds (almost one millisecond)** even when neither timestamp has a zero millisecond.

Example:

- Baseline: `2026-10-24T12:00:00.123000000Z`
- Candidate: `2026-10-25T12:00:00.123999999Z`
- Strict UTC elapsed: **86,400,000,999,999 nanoseconds** (24h plus 999,999ns).
- `Date.parse` elapsed: **86,400,000 milliseconds** (exact 24h), a *false permission to proceed*.

Neither the numbers nor the shop identities in these tests represent a real PLUS/DekaMarkt observation. All collector rows explicitly indicate unavailable items and null prices. Synthetic full-basket comparisons in the report tests are never public savings evidence.

## Executable acceptance matrix

| Surface | Negative case | Required result |
|---|---|---|
| Direct collector | .123000000 → .123999999, +999999ns | `outside-window`, `ready=false` |
| Direct collector | .999000000 → .999999999, +999999ns | Same; no second rollover ambiguity |
| Direct collector | +02:00 baseline / +01:00 candidate across DST, +999999ns | Same, using elapsed UTC |
| Direct collector | Candidate observed before baseline, +999999ns absolute | Same |
| Persisted v1 collector | JSON serialize → canonical restore → +999999ns | Same, no reopening bypass |
| Persisted v1 collector | DST offset + JSON restore, +999999ns | Same |
| M3 full-basket report | .777000000 → .777999999, +999999ns | `unknown`, `claimable=false`, null financial delta/savings, no public claim |
| M3 direct assessment + report | DST offset +999999ns | Unknown/null/no line deltas/no public claim |
| First-observation countdown | .123999999 nanosecond timestamp with only one observed store | Do not present an exact-looking millisecond-truncated `firstObservedAt` or `deadlineAt`: preserve exact nanoseconds under policy A, or abstain under policy B |
| First-observation countdown | Same with +02:00 UTC offset, .456789123 | Offset-normalized exact instant and 24h deadline, or abstain |

Positive controls deliberately preserve **valid trailing-zero whole-millisecond** `.123000000`, `.456000000` and `.777000000` exact 24h and existing +1 *full* millisecond rejection. This contract remains compatible with owner-approved exact-nanosecond implementation or a conservative policy disallowing unsupported *nonzero* submillisecond fractions; do not weaken negative assertions to get GREEN.

Independent QA files:

- `tests/qa-m3-collector-submillisecond-matrix-red.test.mjs` (six tests).
- `tests/qa-m3-collector-restored-millisecond-fractions-red.test.mjs` (three tests).
- `tests/qa-m3-financial-submillisecond-overrun-red.test.mjs` (three tests).
- `tests/qa-m3-single-observation-deadline-precision-red.test.mjs` (three tests, including supported millisecond positive).

## Evidence and release boundary

The single-observation deadline requirement is deliberately policy-neutral: a source fix may represent the exact nanosecond instant in both displayed timestamps, or conservatively refuse a precision it cannot faithfully display. Silently formatting a truncated Date as an exact deadline is not acceptable.

The first combined version of the child on commit `83a46792dd2d1e59929a949be7dc8ed37ba70498` ran [hosted CI #38129716628](https://github.com/Zennay/Supa/actions/runs/38129716628): **703 tests, 683 pass and exactly 20 purposeful expected-RED failures**. This included **12 parent-branch expected-RED collector failures** (the parent concurrently advanced) and **8 new child expected-RED failures**. Positive child controls pass. No unrelated failures appear in the named failing-test list. This is *not* a GREEN release; the CI job deliberately fails.

**Source-owner acceptance:** choose strict nanosecond math or conservative unsupported-fraction rejection as the consistent collector/converter/assessment/report contract. Require separate authorized source repair, fresh independent test-only GREEN, exact-HEAD hosted and applicable permanent VPS/browser evidence, and verified zCloud task ownership and integration review. Adversarial cross-basket [#1508](https://github.com/Zennay/Supa/issues/1508) and genuine human PLUS/DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) are independent open gates.
