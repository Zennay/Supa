# Recipe estimate evidence disclosure — product-core handoff

## Confirmed issue

[Supa #709](https://github.com/Zennay/Supa/issues/709) documents a current user-facing
mistake: the Planner renders `Recipe.estimatedCost` from the controlled M2
fixture as an unqualified exact-looking euro cost per recipe. That is NOT the
calculated basket and NOT an observed supermarket price.

The proper week-budget amount is independently calculated from the basket,
with unresolved matches explicitly non-claimable. No fixture price or
assessment economics should be changed to hide this presentation defect.

## Implemented in this isolated branch

- `src/features/planner/recipeEstimatePresentation.ts` is a pure opt-in
  adapter that distinguishes an **indicative** fixture price from an **unknown**
  unusable estimate.
- Numeric amounts are displayed only after passing the already-established
  strict `euro.format` contract. Invalid, non-finite, negative, inexact-cent
  or unsafe-magnitude values never turn into plausible display prices.
- A visible label includes **Richtprijs** and a separate explanation says the
  value is not the calculated/observed shop price.
- `tests/product-recipe-estimate-evidence-copy.test.mjs` validates current
  controlled recipe fixtures, edge amounts, false-value rejection and
  no mutation of the source fixtures.

## Owner-only production integration

[PlannerView owner PR #423](https://github.com/Zennay/Supa/pull/423) must
replace its current `{euro.format(recipe.estimatedCost)} / recept` with the
presentation adapter **in the owner's branch** after reviewing the copy.
Example (in the currently owned `PlannerView.tsx`, NOT modified here):

```tsx
const recipeEstimate = recipeEstimatePresentation(recipe.estimatedCost)
<small title={recipeEstimate.explanation}>{recipeEstimate.label}</small>
```

A title tooltip is NOT sufficient on its own as a discoverable explanation.
The integrator should prefer a visible helper sentence or keyboard/screen
reader accessible disclosure, using the returned `explanation`. It should
also add rendered Firefox/DOM regression proving the screen cannot reintroduce
the unqualified numeric `€… / recept` text.

**HOLD / not fixed for real users:** this branch deliberately changes only
new files; the existing PlannerView is untouched to preserve #423 ownership.
The integration owner must deliver rendered validation on the exact integrated
head. Neither this helper nor CI success is real M3 PLUS/DekaMarkt evidence.
[Issue #78](https://github.com/Zennay/Supa/issues/78) remains the milestone
exit dependency.
