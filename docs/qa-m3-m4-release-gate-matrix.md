# SUPA M3 → M4 evidence release gate (independent QA)

**Current state — 14 October 2026: M3 ACTIVE; M4 and M5 NOT ELIGIBLE.**
This is a QA contract, **not** beta, retailer-source, deployment, or public-savings authorization. See [Notion SUPA HQ](https://app.notion.com/p/3e79e19ac955810f903be62439eef2b3), [M3 genuine field observation #78](https://github.com/Zennay/Supa/issues/78) and [M3/M4 release-gate issue #2063](https://github.com/Zennay/Supa/issues/2063).

## Evidence matrix

| Proposed claim or transition | Required positive proof | Mandatory negative control | Current status |
| --- | --- | --- | --- |
| M3 complete basket comparison | One genuine PLUS baseline and DekaMarkt candidate for **the same eleven demands on both sides**; source/time/context/pack/provenance recorded for each line; timestamps <= 24h apart | Each of 11+11 explicitly unavailable fictional lines stays unresolved; an unobserved null availability is refused; numeric zero bookkeeping must never be interpreted as a zero-price full basket | **OPEN — human #78** |
| M3 money saved | Observed complete comparable baseline, exact integer-cent calculations, explicit worse/same/unknown alternatives; independently reviewed attribution and source rights | Any unavailable source row remains unknown with null delta and null savings even if it carries a tempting hidden price; a synthetic complete basket NEVER permits public savings claims | **HOLD** |
| M3 privacy and custody | Private source ID, observedAt, authorized capture method, consent and original sheet; safe public aggregate | Participant key or private provenance must not survive report serialization; assessor must not overwrite source inputs or partially published output | **HOLD**, independent validation required |
| M4 less planning effort | Consented target-student sessions after *genuine* M3 sign-off; paired time/edits/decision evidence with reproducible provenance | Missing/abandoned duration, unsafe integer values, overflow or edited events must not be converted to zero/success | **HOLD — #2049** |
| M4 flexibility | Multiweek closed-loop plan/edit/recovery/adherence observations with consent and trustworthy event sequence | Missing, swapped, skipped or contradicted meal events are not success; no invented retention or private participant leaks | **HOLD** |
| M3 → M4 release | Human review of M3 source+rights+privacy, latest-main exact-head CI, relevant permanent VPS Firefox/mobile/browser artifacts, independent zCloud scope claim/lease, explicit decision | A manually supplied `m3Gate.status=closed` or green unit tests alone do **not** authorize beta/public prices | **NOT APPROVED** |

## Executable checks

Two **independent QA** suites on `main` / isolated QA branch, using only synthetic fixtures:

- `tests/m3-qa-release-gate-evidence-matrix.test.mjs` (existing on `main`): 11+11 fully unavailable rows, explicit null rejection, hidden prices, one-sided unknown, better/same/worse fully fictional baskets, privacy, separate source/derived/report output preservation and M4 private validation.
- `tests/m3-qa-mixed-availability-matrix.test.mjs` (this QA change): 12×12 possible per-store single-unavailable-row/fully-observed combinations × three fictional candidate-price directions = **432 cases**. **429** incomplete outcomes must keep money unknown/null and public claims false. The **three** complete fictional comparisons may be technically comparable but **still may not generate a public claim**. Every generated report excludes an explicit private canary.

The new matrix is designed to catch a future regression where `available:false` records still expose `priceCents` and a consumer accidentally counts it in a complete comparison. It is not a measurement of actual Dutch supermarket prices, pack availability, student usage or source permissions.

## Evidence and handoff

| Release dependency | Latest verified state |
| --- | --- |
| Independent QA base | Original isolated base `4356c8b7e4cf8b717d199e05468fec5ec5eac1b7` (14 October 2026). Check current `main` again before merge. |
| Exact-final-head hosted Node, audit-high, M1 permission/matching, TypeScript/Vite | **UNVERIFIED** until GitHub Actions completes on the candidate SHA. Do not infer from older CI. |
| Permanent VPS M2 Firefox/mobile and M3 workflow | **UNVERIFIED** for this candidate. Hosted CI is not a substitute. |
| Independent zCloud SQLite scope preflight/write lease | **NOT VERIFIED**; no deployment, owner-branch modification or release action authorized by this test-only draft. |
| Genuine PLUS11+DekaMarkt11 human field run | [#78 **OPEN**](https://github.com/Zennay/Supa/issues/78). No authentic price or savings proof. |
| Source-permission, QA/owner review and M4/public-claim approval | **NOT GRANTED**. Human approval remains mandatory for field usage and release. |

**Parallel scope:** quality-validation test/docs only. Do not edit source logic, observations, browser workflows, other workers' drafts, real retailer inputs or production VPS/DB. The historical independent [QA #2064](https://github.com/Zennay/Supa/pull/2064) remains untouched. Other open issue owners retain their areas: [M4 safe numbers #2049](https://github.com/Zennay/Supa/issues/2049), [M3 overwrite #2035](https://github.com/Zennay/Supa/issues/2035), [M3 output races #2039](https://github.com/Zennay/Supa/issues/2039), [fork runner safety #365](https://github.com/Zennay/Supa/issues/365).
