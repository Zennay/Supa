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

## Read-only recipe-change reuse preview

The same isolated product lane also contains:

- `src/domain/ingredientReusePreview.ts`: `previewRecipeReuseChange()` re-evaluates the
  **same active days** from the actual current and proposed plans. It reports
  newly shared, no-longer-shared and differently distributed ingredients. It
  does not apply the replacement or infer basket prices.
- `src/features/planner/IngredientReusePreviewCard.tsx` and isolated CSS:
  passive Dutch before-selection guidance, including no-op and unknown states.
- Executable 96-case active-day × recipe-choice matrix, true React SSR,
  malicious-label escaping and narrow viewport CSS tests.

The transition uses `beforeSharedMealCount: null` when an ingredient was *not
shared*, and `afterSharedMealCount: null` when it stops being shared. Null
**does not mean the ingredient occurred in zero meals**; it can still occur
once. This avoids implying a nonexistent quantity or buying decision.

### Optional integration, coordinated with the same PlannerView owner

Build a fresh preview from current planner props immediately before showing a
recipe-choice suggestion:

```ts
const preview = previewRecipeReuseChange({
  plan: plannedMeals,
  recipes: fullRecipesWithIngredients,
  activeDays,
  day: selectedDay,
  recipeId: candidateRecipeId,
})
```

Display `<IngredientReusePreviewCard preview={preview} />` without wiring an
implicit selection handler. The existing user-controlled `onRecipeChange`
remains authoritative. Keep this distinct from [#1062](https://github.com/Zennay/Supa/pull/1062),
which handles a *separate* before/after basket-price computation with its own
financial proof gates. Do not show money on the reuse card. The current
PlannerView owner must verify a real rendered active-week toggle, recipe
selection, keyboard reading order, narrow screen and price-claim absence.
