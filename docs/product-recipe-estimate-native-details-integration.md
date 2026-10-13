# Product-core #709 — native recipe richtprijs details (review-only)

This child follows **frozen product owner [PR #1049](https://github.com/Zennay/Supa/pull/1049)**, not `main`. The owner already implemented `recipeEstimatePresentation()` and an accessible `RecipeEstimateDisclosure`; this additive integration option fills one distinct gap: visible explanations usable via **keyboard, touch and mouse without hover**.

## New optional product surface

`src/features/planner/RecipeEstimateDetails.ts` composes the **existing owner adapter** into:
- Visible `Richtprijs: … / recept` or `Richtprijs onbekend`.
- Native **44px minimum-height** summary tap target with wrapping and pointer affordance, preserving the browser's original disclosure marker and focus/keyboard behavior.
- Native, unfocused-by-default `<details><summary>Waarom (geen) richtprijs?</summary>…</details>` so keyboard Enter/Space and taps open the explanation without custom JS state, tooltips or direct DOM access.
- Plain, visible copy explicitly disavowing live/current supermarket pricing. No new offers, retailer source, economics, public saving, participant info or persistence.

`tests/product-recipe-estimate-native-details.test.mjs` SSRs **actual React** for all inherited fixture recipes, invalid/inexact values, cent-exact examples and semantic native controls. Existing owner source/component/tests untouched.

## Owner integration contract (not performed)

The **original [PlannerView owner #423](https://github.com/Zennay/Supa/pull/423)** owns `src/features/planner/PlannerView.tsx` and integration into visible recipe cards. The owner must replace its exact-looking `euro.format(recipe.estimatedCost) / recept` output after resolving active changes and choose either the previous disclosure or this native details replacement, not both overlapping labels. Example owner-only composition:

```tsx
<small>{recipe.minutes} min</small>
<RecipeEstimateDetails estimatedCost={recipe.estimatedCost} />
```

On integration, check 320–430px screens for the real 44px summary tap target and text wrapping, Enter/Space keyboard and mobile tap expansion, screen-reader announcement of summary and details, and that resolved/unresolved week-budget cards still source **only** the trusted basket. Tests require rendered Firefox/mobile on the **exact integrated head**, original owner acceptance and zCloud claim/lease/preflight before any merge or deploy.

## Proof boundary

A green isolated child confirms this **option compiles and renders** but **does not fix routed Planner UI** until original owner integration. Do not count copied M2 fixture estimates as real retailer prices, change live basket evidence or promote a savings claim. Human M3 [#78](https://github.com/Zennay/Supa/issues/78) stays OPEN; M4 stays ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** without explicit authorization.
