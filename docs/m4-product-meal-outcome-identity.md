# M4 meal outcomes: one final record per canonical planned slot (#1325)

Product-core source integration of the existing **independent opt-in quality finding** [issue #1325](https://github.com/Zennay/Supa/issues/1325). The [QA sidecar #1329](https://github.com/Zennay/Supa/pull/1329) and its [Unicode mark fix #1335](https://github.com/Zennay/Supa/pull/1335) are separately owned and remain unchanged; this DRAFT source branch does **not** take over their artifacts.

## Product behavior

The default M4 validation and real CLI used to count every `meal_outcome_recorded` event independently. Two outcomes for a single meal could inflate the denominator and make private adherence appear misleading. Now each reported `meal_slot` must be a bounded, perceptible, canonical identity, with exactly **one** terminal outcome per NFKC-equivalent slot across the entire input event list. If two outcomes conflict, repeat, or are both unknown, reject the entire input: never silently pick the first/last nor deduplicate an actual record.

- Allow meaningful Unicode letters, numerals, punctuation, pictographs and attached combining marks. Normalize with NFKC **only for identity comparison**, never overwrite original data. This catches full-width/spelling-equivalent duplicates.
- Refuse blank/trim-padded/over-256-byte identifiers, Unicode controls/format surrogates/unassigned/private-use code points, and stand-alone combining/variation marks even when a compatibility transform strips their visible facade.
- Existing valid one-outcome-per-slot adherence semantics remain unchanged: `followed / known outcomes`; unknown records are excluded from the denominator, no known outcomes yield null. Abandoned and unknown partial sessions are still accepted without fabricated weekly completion. No source mutation.
- Source validation happens **before** `buildBetaSessionSummary`, including for the CLI with `--output`. Invalid source never creates a private report.

## Executable proof

`node --test tests/m4-product-meal-outcome-identity.test.mjs` covers direct validation, 0/1/mixed known/unknown rates, honest incomplete cases, duplicate followed, contradictory, unknown-first, NFC/NFKC-equivalent identities, mark-only/control/trimming and oversized identities, accepted visible Unicode, late duplicates and actual CLI refusal without report or source mutation. Entirely synthetic data with **artificial `m3Gate.status=closed`** exists only to exercise M4 code; it never authorizes real beta participants.

This scope is intentionally smaller than independent sidecar memory/JSON graph admission checks. Future source integration of more extensive protections requires independent owner review and regression replays.

## Release boundary

Supa remains in **M3**, human [PLUS + DekaMarkt #78](https://github.com/Zennay/Supa/issues/78) OPEN, M4/M5 ineligible. **DRAFT / HOLD / NO MERGE / NO DEPLOY** until original QA #1329/#1335/#1336 and other current M4 QA independently replay on the final composed source, zCloud independent preflight/write claim/lease, exact-head hosted and applicable permanent VPS checks, current-main review, source owner and explicit human release authorization. No observed retail prices, personal beta records or public savings claims.
