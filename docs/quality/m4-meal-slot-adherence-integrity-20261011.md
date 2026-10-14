# SUPA quality-validation — M4 meal-outcome identity & adherence (2026-10-11)

## Stage and non-activation boundary

**M3 ACTIVE; issue #78 real same-context PLUS/DekaMarkt observation is still open.** The M4 private beta remains **not authorized to execute**, recruit participants or promote savings/effort claims. This is offline QA preparation using synthetic data with a fake `m3Gate.status: closed` fixture only. Such a fixture is **not evidence** that AUD-003/PWQ-14 has closed.

## Source-level finding — #1325

The existing `buildBetaSessionSummary` counts **events**, not distinct meal-slot identities, when computing plan adherence. Two records for `monday-dinner: followed` and one `tuesday-dinner: skipped` yield `2/3` even though only two unique meal slots have known outcomes. Contradictory `unknown` and later `followed` records have no explicit version/correction policy. The original default entrypoint therefore cannot assert a well-defined per-meal denominator from such data. No actual participant record has been observed with this problem.

## W1 opt-in quality reference

`scripts/m4-meal-slot-integrity.mjs` adds a read-only `validateM4MealSlotIntegrity` and `buildM4SummaryWithMealSlotIntegrity` wrapper. It snapshots bounded **plain JSON data** without invoking getters, applies the source owner's existing validator, and denies duplicate exact/NFKC-equivalent `meal_outcome_recorded.meal_slot` keys **before** summary derivation. Rejects whitespace-padded/empty/invisible/overlong slots, huge arrays and exotic source data; limits the complete admitted JSON value/key text to **1 MiB aggregate UTF-8**, including otherwise permitted auxiliary fields (with a separate 16 KiB per-string bound); does **not** de-duplicate or invent a winning outcome. Retains known vs unknown/missing distinction, partial/abandoned sessions and `publicClaimEligible: false`.

Tests: `node --test tests/qa-m4-meal-slot-adherence-integrity.test.mjs`. The suite includes a concrete synthetic original-entrypoint vulnerability demonstration (expected numeric inflation, not a failing test), contradictory duplicates, Unicode equivalents, full-batch atomic refusal, no input mutation and consent/M3 gate baseline. W2 further proves aggregate UTF-8 admission rejects many independently short but collectively oversized auxiliary fields without editing input, while a genuinely abandoned synthetic week retains unknown/null measures instead of implying completion. No participant names, real M3 proof, retailer requests or proxies.

## Ownership and acceptance

The existing M4 validator and its timestamp hardening remain owned by [PR #151](https://github.com/Zennay/Supa/pull/151), and are **not edited**. This branch adds only an independent optional sidecar, tests and this document on the current immutable main, without altering default CLI/output pathways.

This proposal is **DRAFT/HOLD** pending owner composition into a trusted beta event production path, independent privacy/research review, a correction/version policy for legitimately revised meal outcomes, exact-head CI on hosted and relevant permanent VPS, real [#78](https://github.com/Zennay/Supa/issues/78) M3 proof and explicit go/no-go for M4. Passing a local synthetic fixture cannot close any of those gates.
