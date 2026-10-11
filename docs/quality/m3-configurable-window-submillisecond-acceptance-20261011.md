# M3 configurable observation window: submillisecond acceptance (2026-10-11)

## Scope and non-evidence warning

Independent quality-validation extension of [open #1513](https://github.com/Zennay/Supa/issues/1513). This is a **synthetic regression experiment**, not a PLUS or DekaMarkt field observation, price, retailer permission, or savings proof. M3's genuine two-store same-demand run remains [#78](https://github.com/Zennay/Supa/issues/78). Independent cross-basket atomicity [#1508](https://github.com/Zennay/Supa/issues/1508) remains separate.

Canonical `main` pin at test creation: `22edb59b7c96311b686161b74a9fc2060e3c5d77`. Two new executable QA files: `tests/qa-m3-configurable-window-nanosecond-red.test.mjs` and `tests/qa-m3-fraction-length-4-to-9-red.test.mjs`. No change to preexisting source, workflow, test, fixture, field data, or owner branches.

## Why test this

The observed-week assessor exposes `maxObservationWindowHours` as a positive finite number, while field workflow defaults to 24 hours. Its strict test must measure the actual elapsed instants rather than the millisecond-truncated `Date.parse` difference. The same safety failure therefore applies to a 15-minute operator window or 90-minute research window, not only the fixed 24h field protocol. The new cases deliberately test **1ns past the limit** with an independent BigInt epoch-nanosecond oracle.

| Case | Budget | Input edge | Expected |
| --- | --- | --- | --- |
| Fraction `.123456000` to `.123456001` | 15m | hidden +1ns, within one parsed millisecond | abstain |
| Reversed observation order | 90m | first observation 1ns later beyond bound | abstain |
| Spring DST `+01:00` to `+02:00` | 24h | absolute UTC +24h+1ns despite wall-clock change | abstain |
| 2024 leap-day rollover | 1h | elapsed 1h+1ns | abstain |
| Trailing-zero 9-digit precision | 15m | exactly on budget | claimable when all other evidence is sound |
| Spring DST with trailing zeros | 24h | exactly on budget | claimable when all other evidence is sound |
| Millisecond-native overrun | 15m | +1ms | abstain |

Safety requirement: an invalid or unsupported-precision pair must yield `claimable=false`, `comparison.claimable=false`, `outcome='unknown'`, `deltaCents=null`, `savingsCents=null`, `lineDeltas=[]`, and nonempty diagnostic reasons. Neither basket's prices should be publicly claimed. Merely rounding down elapsed time or formatting an approximate 0.00h is **not** a repair.

Accept either exact fractional comparison through 9 digits or conservative rejection of timestamps requiring unsupported nonzero fractional precision beyond milliseconds. Preserve full UTC-offset semantics, explicit reversed ordering, and exact-boundary values with only trailing zero precision.

## Cross-precision coverage

The second executable file independently challenges all six loss-bearing ISO fraction lengths (4, 5, 6, 7, 8 and 9 decimal digits). The elapsed intervals exceed 24 hours by exactly 100,000ns, 10,000ns, 1,000ns, 100ns, 10ns, and 1ns respectively, while `Date.parse` rounds all pairs to the same 24-hour millisecond difference. Nine supported 1–9-digit trailing-zero precision controls and a +1ms rejection control verify that a future fix does not disable legitimate exact-boundary evidence.

## Validation and release posture

1. New executable expected-RED cases should fail specifically at +1ns and controls should pass; record exact SHA and hosted CI result. A RED suite confirms the gap; it **does not** establish a fix.
2. Obtain original source-owner policy and verified zCloud lease before source editing. Do not alter other active PR branches.
3. Repair in a separate narrow owner-approved source PR, then independently verify the exact postrepair head with the new cases and previous #1512/#1516/#1518 time-surface regressions; run hosted build, appropriate permanent VPS/Firefox M3 checks, and main replay review.
4. Keep **DRAFT / HOLD / NO MERGE / NO DEPLOY**, without claiming genuine retailer savings until the field issue #78 is resolved with real evidence.
