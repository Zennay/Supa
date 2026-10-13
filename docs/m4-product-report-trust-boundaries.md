# M4 report trust boundaries — source-owner policy

Additional synthetic product-core hardening in [DRAFT #2114](https://github.com/Zennay/Supa/pull/2114) for independently observed gaps [#2084](https://github.com/Zennay/Supa/issues/2084), [#2075](https://github.com/Zennay/Supa/issues/2075) and [#2049](https://github.com/Zennay/Supa/issues/2049).

## Direct identity
The derived private report includes `sessionId` and `population` but intentionally excludes `participantKey`. A privacy flag alone does **not** prevent direct identity leakage from the two included fields. The validator now requires a lowercase path-safe, non-contact 3–64 character `sessionId` (letters, numbers, underscore and hyphen) and refuses email-like identifiers in both fields **before** a report exists. Validation diagnostics give only a field name, not the submitted identifier. This is a bounded email-like guard, **not** comprehensive personal-information detection: researchers still need data minimization and governance.

## Basket certainty
A `basket_assessment_viewed` event with `unresolved_line_count > 0` may **only** have `outcome=unknown`. A fictional complete basket (0 unresolved) can record `better`, `same` or `worse` privately, but zero unresolved lines do not prove eligibility or require a determinate outcome. `publicClaimEligible=false` remains unaffected.

## Safe numerics
Nonnegative and positive integer metrics (budget cents, durations, decisions, edits, counted days, etc.) require `Number.isSafeInteger` instead of only `Number.isInteger`. A `repairManualEdits` aggregate additionally refuses an unsafe-integer sum even when each constituent edit count is individually safe. Zero and `Number.MAX_SAFE_INTEGER` bounds are accepted where schema-appropriate; overflow is not rounded into reported evidence.

## Test boundaries
`node --test tests/m4-product-report-trust-boundaries.test.mjs`: synthetic positive privacy/unknown/known examples, direct-ID and newline metadata rejection, unresolved basket better/same/worse rejection, individually unsafe integer fields, exact MAX_SAFE acceptance, aggregate overflow, and real CLI no-output-on-invalid checks. Original source files are never modified by tests; neither real M4 recruitment nor participant records nor true M3 evidence are implied.

Independent QA [#2085](https://github.com/Zennay/Supa/pull/2085), [#2076](https://github.com/Zennay/Supa/pull/2076), [#2050](https://github.com/Zennay/Supa/pull/2050) retain their frozen own source and require independent corrected-source replay. Genuine PLUS+DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) OPEN: **M3 active, M4/M5 ineligible**. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending zCloud claim/preflight/lease, original owner, all-GREEN exact-hosted/current-main/applicable permanent VPS and explicit human release go.
