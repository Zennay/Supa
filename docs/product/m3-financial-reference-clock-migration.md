# M3 financial assessment: explicit evaluation-time contract

**Scope:** private, synthetic-only direct API guard for [issue #1180](https://github.com/Zennay/Supa/issues/1180). Supa is **M3 ACTIVE**. This change does not validate genuine PLUS/DekaMarkt observations or source rights, does not authorize public savings and must not promote M4/M5.

## Why the contract changes

The exported pure domain function `assessWeeklyBasketStudy(study)` used to treat an omitted `referenceNowMs` as *no future-observation check*. A fictional fully matched 2099 PLUS/DekaMarkt pair one hour apart could therefore produce `claimable: true` without anyone having visited a store.

The old domain's determinism contract in `tests/domain-determinism-boundary.test.mjs` correctly prohibits global time reads (`Date.now`, `new Date`, etc.) in the financial calculation module. **Do not work around that guard.** A financial result cannot establish whether a capture is in the future from a timestamp alone. A trustworthy evaluation instant must be supplied by the entry point.

## Contract and call site

**Before** (unsafe for a direct externally exposed caller):

```js
const result = assessWeeklyBasketStudy(study)
// Future times could bypass the validation and produce claimable=true.
```

**Now** (production caller pins one evaluation instant):

```js
const evaluationTimeMs = Date.now() // at the trusted CLI / UI / API boundary
const result = assessWeeklyBasketStudy(study, { referenceNowMs: evaluationTimeMs })
```

If the caller omits the clock, the result is `claimable: false`, `outcome: 'unknown'`, no line deltas and null money deltas/savings, with reason `assessment reference clock is required`. `null`, `NaN`, infinities and strings are invalid. Past observations are **not rejected for age**; the existing declared-week window and <=24h pairing requirements remain separate.

The real private CLI entry point `scripts/m3-assess-observed-week.mjs::buildObservedWeekReport` already passes `Date.now()`, and the Meten UI maintains a real reference clock. A deterministic synthetic test must explicitly pass a deterministic valid reference instant rather than change the production behavior. Do not expose a user-controlled `--now` to production.

## Coordination before integration

This is a **review-only** scope at first. Existing legacy Node and independent QA tests with positive `assessWeeklyBasketStudy(study)` examples expect the prior clockless mathematical behavior. Their owners should migrate *positive cases only* to `assessWeeklyBasketStudy(study, { referenceNowMs: ... })`. For fixed historical 2025/2026 synthetic fixtures, use a pinned evaluation instant later than both captures; for a runtime production boundary, use the actual clock. Keep independent negative/unknown controls intact, retain the red reproduction [QA #2794](https://github.com/Zennay/Supa/pull/2794) as acceptance evidence, and avoid editing QA-owned files on this product branch. Do not relax the deterministic domain test or infer human approval from a successful synthetic comparison.

**Do not merge this draft** until source owner and independent QA owner coordinate this contract, original source and QA branch ownership is respected, zCloud SQLite scoped write lease is independently confirmed, full exact-head suite and permanent M3/VPS gates are green, and an authorized merge review occurs.

## Release hold remains separate

- [Genuine matched human basket pair #78](https://github.com/Zennay/Supa/issues/78): PLUS baseline 11/11 and DekaMarkt candidate 11/11, same canonical demand and price context, observed <=24h apart, private sourced pack/stock/checkout facts. No fictional test is a substitute.
- [Retailer permissions #74](https://github.com/Zennay/Supa/issues/74): written scope/terms from both retailers required before automated live source reuse.
- No retail HTTP, no public euro savings, no beta promotion or deploy from this change.
