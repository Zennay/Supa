# Independent QA acceptance — M3 synthetic field rehearsal

**Status: DRAFT / HOLD / NO MERGE / NO DEPLOY**. Source parent is frozen product PR #2066 at `f1742feb307844e4c82d42c54533327ece0c3c64`. These checks add no production logic, do not collect real observations and do not authorize a human study or beta.

## Independent execution contract

Run `node --experimental-strip-types --test tests/m3-field-rehearsal-*-qa.test.mjs`, or `npm test` on the candidate SHA. The QA file reuses the real canonical M3 observation-sheet converter and assessor; its fixtures are explicitly fictional. It does not call a retailer endpoint or write M3 studies.

| Gate | Executable independent acceptance | Release meaning |
| --- | --- | --- |
| 11+11 unavailable | Four fresh copies yield 11 unresolved products on both sides, `unknown`, null delta/savings, and no public claim | Not a collected basket or proof of savings |
| Cent arithmetic | Nine synthetic candidate unit prices (1–999 cents) cross better/same/worse and preserve exact cent totals and the direction of the comparison | Prices are fictional; positive numeric results stay private |
| Repeatability | Mutating a discarded priced fixture cannot poison a fresh priced run or a new complete rehearsal | Not proof of real persistence behavior |
| Multi-timezone CLI | Same single-line JSON bytes under UTC, Amsterdam, New York and Auckland; strict ten-key schema; no participant, source, money or region values in stdout/stderr | No observed-week financial evidence exposed |
| CLI filesystem containment | Six file/help argument variants all reject with sanitized errors; pre-existing canary unchanged; no new output | Tests CLI argument paths only, not an adversarial filesystem sandbox |
| No-network execution | A process preload replaces fetch, HTTP(S), TCP, TLS and DNS with throwing guards; a positive control demonstrates that a fetch is blocked, while the real rehearsal still succeeds | Verifies these APIs on this exact synthetic run, not every possible indirect network channel |

## Required proof before any change of release posture

1. Pin exact QA HEAD and frozen product parent. Verify GitHub compare shows **only** two new QA test files and this document relative to #2066, with no changes to its original three files.
2. Inspect hosted CI, test counts, npm audit high, source permission gate and production build for the exact final QA HEAD; require applicable permanent VPS mobile/M3 tests when triggered. A queued check is **not** a passed gate.
3. Request independent zCloud scope preflight, write claim/lease and owner review; preserve product owner branch unchanged.
4. Separately close **human issue #78** with one genuine 11+11 same-demand PLUS baseline + DekaMarkt candidate observation pair, same context within 24 hours, source/provenance protected, privacy reviewed and accurately characterized even if candidate is worse/unknown.
5. Resolve or accept outstanding safety gates #2035 (source/output aliases), #2039 (atomic publication) and #2049 (safe integer M4 evidence) under their separate ownership before M4 consideration.
6. Preserve `publicSavingsClaimEligible=false`, `m3ExitProven=false` and `m4BetaEligible=false` for all fiction. Require named reviewer and explicit approval before merging, releasing or recruiting.

Synthetic success shows regression coverage, **not** a live retailer-price observation, actual monetary benefit, participant trial, M3 exit, or M4 eligibility.
