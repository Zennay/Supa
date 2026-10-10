# M3 task-first next action — owner integration note

**Scope:** Supa product-core, [issue #594](https://github.com/Zennay/Supa/issues/594). The isolated helper `observationNextAction(sheet)` lives in `src/features/observation/observationNextStep.ts`; its isolated regression tests are in `tests/product-m3-observation-next-action.test.mjs`.

## Contract

- The helper returns the **one next concrete task**, not the raw total number of metadata/line errors.
- Study setup uses task-oriented Dutch copy and a pseudonymous participant code.
- Collection walks through PLUS details and ingredients **before** DekaMarkt details and ingredients, while preserving the canonical ingredient IDs for navigation.
- Missing product information is never invented. It remains a collection task.
- `observationSheetReadiness` stays authoritative; outside-window, malformed, incomplete, or otherwise invalid observations return a review action rather than an export-ready claim.
- Even a complete form is **only a draft**. Its export requires downstream conversion and assessment and does not prove savings.
- No live PLUS/DekaMarkt prices, observed basket pair, matching decision, financial claim, or M3 exit were generated.

## Owner-safe UI integration

The active `ObservationView.tsx` owner should, after reconciling concurrent work:

1. Import `observationNextAction` from `./observationNextStep.ts`; derive `const action = useMemo(() => observationNextAction(sheet), [sheet])`.
2. Make `action.title` the primary task prompt and `action.detail` the supporting explanation. Keep all canonical readiness messages accessible in a subordinate review details section; do **not** replace readiness enforcement.
3. For `action.stage === 'line'`, route the next-action control to the existing `jumpToNextIncomplete` only when its `side` and `ingredientId` match the current canonical `nextIncomplete` target. Otherwise show an informational hint, never navigate to guessed data.
4. For `stage === 'study'` or `'store'`, focus the respective existing form field with real label semantics, or show informational copy until deterministic field mapping exists.
5. For `stage === 'export'`, keep download *explicitly user-triggered*; do not automatically upload, validate, claim savings, or publish.
6. Replace remaining implementation jargon within existing import/reset/readiness messages carefully. Keep the underlying persisted schema, validation and safety constraints unchanged.
7. Run the full unit/build gate and actual Firefox/mobile rendered test on the exact integration head. Confirm task order with keyboard and touch, and no misleading completion state after a reload.

**Boundary:** `ObservationView.tsx` is already in the active #327 → #329 → #332 → #522 ownership stack. This PR deliberately does not edit it or imply customer-facing integration. The real M3 exit still requires [issue #78](https://github.com/Zennay/Supa/issues/78): authentic same-demand PLUS+DekaMarkt collection in the same context within 24 hours.
