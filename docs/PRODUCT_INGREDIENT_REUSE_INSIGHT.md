# Product-core · ingredient overlap explanation (candidate)

## Outcome

A learner planning meals should see *which exact ingredients occur on multiple
active planned days*. This supports the SUPA loop
**plan → reuse → combined demand → basket** without implying that reuse alone
saves money or avoids leftovers.

## Implemented as isolated additions

- `src/domain/ingredientReuse.ts`: pure `buildIngredientReuseInsight` derived
  from the current plan, active days and canonical recipe ingredients.
- `src/features/planner/IngredientReuseCard.tsx`: passive Dutch explanation.
- `src/features/planner/ingredient-reuse.css`: mobile-safe label containment.
- `tests/product-ingredient-reuse-insight.test.mjs`: real fixture plan, changes,
  repeat ingredients, invalid data and deterministic chronology.

There is **no duplicate pack-pricing engine**. The domain function delegates
ingredient identity/definition consistency to the canonical
`aggregatePlanIngredients`. Quantity totals are deliberately not exposed
while fractional precision issue #1053 and its owner PR #1054 are outstanding.

## UI integration boundary

Active `PlannerView.tsx` is owned by PR #423 (planner domain PR #342).
Do not edit either owned path in this candidate branch.

After coordination, the PlannerView owner can:
1. Pass current `PlannedMeal[]`, full `RecipeWithIngredients[]` and
   `activeDays[]` directly to `buildIngredientReuseInsight` on each current
   render, **not** a saved/stale insight.
2. Render `<IngredientReuseCard insight={insight} />` below editable meals.
3. Keep the full ingredient definitions in the parent; the existing
   `Recipe[]` used by PlannerView is intentionally not enough.
4. Test toggling days, changing recipes, long labels, keyboard zoom and the
   actual Firefox/mobile planner after integration.

## Safety / scope

- An active day requires exactly one matching recipe. Bad, duplicate, absent
  or ambiguous data returns `null`, never a confident overlap.
- Two occurrences **within one meal** do not count as reuse across days.
- No storage or mutation; no price, offer, observed data, predicted leftovers,
  pack savings, attribution or consumer financial claim.
- Fixture-based test data is synthetic. The genuine PLUS/DekaMarkt M3 same-
  demand observation in #78 remains a separate release gate.
- Keep as **draft/hold** pending owner review, exact-head CI and integrated
  Firefox/mobile proof. Do not merge/deploy from this helper-only evidence.
