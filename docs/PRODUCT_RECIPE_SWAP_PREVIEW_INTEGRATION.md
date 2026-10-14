# Product-core: recipe change impact preview (isolated handoff)

## Why
SUPA's planner-first value is its closed loop: recipe choice must update exact aggregate ingredient requirements and complete pack economics, not simply sum recipe estimate cards. Changing a planned meal should tell the student what *would* change before confirmation, while preserving existing shopping progress until the student chooses to apply it.

## New primitives
- `src/domain/planRecipeSwapPreview.ts`: `previewPlanRecipeSwap({ store, plan, recipes, activeDays, products, day, replacementRecipeId })`. Rebuilds **both** complete one-store baskets from the *same* input store/catalog using current matching and ingredient aggregation, maps per-ingredient added/removed/changed trace lines, and returns an independent `nextPlan` without mutating any persisted plan. Same-recipe and inactive-day edits are deterministic.
- `src/domain/planRecipeSwapPreview.ts`: `acceptPlanRecipeSwap(preview, currentPlan, currentActiveDays)` is a **pure, explicit-approval** helper. It refuses stale previews if the current plan/day selection changed, checks that the proposed single-day edit has not been tampered with, and returns a separate plan copy without persisting.
- `src/features/planner/RecipeSwapImpactCard.tsx`: optional passive mobile-friendly, accessible preview. It displays both ingredient demand and whole packs; announces only the price summary to screen readers. Money uses the cent-native formatter, never floating-point euro conversion. No action button or silent saving.
- `tests/product-plan-recipe-swap-preview.test.mjs`: exercises exact pack economics, sharing, missing items, safety and immutable inputs.
- `tests/product-plan-recipe-swap-acceptance.test.mjs`: explicit confirmation, user-choice override for incomplete prices, stale live state, defensive copies, and tampered preview refusal.

## Truth/UX rules
1. `deltaCents` is **new basket total minus old basket total** within one shop/catalog. It is NOT cross-store savings, not a live price claim and never an observed M3 outcome. Negative means a cheaper theoretical basket in the *provided* catalog only.
2. `status: 'ready'` requires both baskets to be nonempty, all lines matched, trusted integer cents, consistent line totals and no integer overflow. Otherwise `status:'unknown'` forces `deltaCents:null`; show uncertainty rather than a fabricated price.
3. `status:'invalid'` rejects ambiguous days, duplicate planned days, nonexistent recipe, ambiguous recipe identity and malformed collections. Never apply `nextPlan` from invalid output.
4. Edits on inactive days may leave basket unchanged; empty active week must never display a claimed delta.
5. User explicitly confirms a recipe swap through the planner's own control, **after** reading this preview. Merely rendering a preview must not update saved week, shopping-list checkboxes or the basket. Call `acceptPlanRecipeSwap` *inside* the explicit click handler with **current** plan and selected days. On `stale` regenerate the preview; on `invalid` do not persist anything. `unknown` prices still permit the customer's explicit recipe selection. No automated cheapest-recipe choice.
6. Keep `priceEvidence:'input-snapshot-only'` and the disclosure text. Source timestamps, retailer permission and authenticity remain separately gated. If the catalog/store changes between render and click, recompute the preview before confirmation: this helper checks planner staleness, **not** external live catalog freshness.

## Integration owner boundary / acceptance
**Not yet connected to the rendered planner.** Active PR [#423](https://github.com/Zennay/Supa/pull/423) owns `PlannerView.tsx` / planner CSS and active PR [#342](https://github.com/Zennay/Supa/pull/342) owns the planner domain. This independent PR adds zero modifications to their files. The owner may import the helper and read-only component after coordinated landing, but must prove:
- Preview before the confirm/apply control; keyboard/screen reader and mobile Firefox work. A `<select>` that auto-applies `onChange` must become a two-step choose → preview → explicit confirm flow so the summary is not shown after mutation. Keep cancel functional.
- No implicit commit or shopping-checkbox reset on preview. Confirm makes exactly one saved recipe edit.
- Same-store, same-context values only; no M3 field price or savings labels.
- Exact cents, pack reuse, underfilled/unknown matches, empty active-week and invalid restore are handled.
- Active issue [#1053](https://github.com/Zennay/Supa/issues/1053): original per-meal decimal aggregation can still round incorrectly near pack boundaries until the basket owner integrates its dedicated fix. This preview deliberately reuses *existing* basket economics and does not claim to solve that separate bug.

## Phase
SUPA remains **M3 ACTIVE**, awaiting genuine same-demand PLUS and DekaMarkt field observations within 24 hours [#78](https://github.com/Zennay/Supa/issues/78). The M2 fixture is synthetic. Draft/hold for exact-head hosted CI and self-hosted review; no automatic production deployment.
