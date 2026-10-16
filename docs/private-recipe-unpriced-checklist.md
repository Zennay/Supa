# Manual recipe shopping checklist without store prices

Scope: product-core standalone feature, stacked after draft PR #3291, originally on reviewed recipe composition #3285.

Function: prepareUnpricedShoppingPreview(plan, privateRecipes, activeDays).

Real implemented flow:
1. Accept only previously reviewed private MANUAL recipe candidates (no imported URL, unverified costs or other identities).
2. Feed a strictly local offline/no-catalogue basket through existing buildOneStoreBasket and aggregatePlanIngredients, not a second matching engine.
3. Call Supa's existing preparePrintableShoppingChecklist and buildShoppingListCopyText for a user-reviewed Dutch printable/copyable shopping list.
4. Return ONLY review-required checklist/copy data, NOT the basket or its numerical total. Every product selection stays unresolved until a real retailer dataset has source rights, provenance, freshness and actual matching.

Legacy RecipeWithIngredients.estimatedCost is a required number. The internal basket read path currently never uses this estimate. The wrapper supplies Number.NaN ONLY as an explicitly non-price sentinel, never 0 and never exposes it. This code must be revisited alongside the separately owned nullable estimated-cost domain/UI migration. Neither the feature nor the adapter is mounted in App.tsx while #3088 has active ownership.

Native tests cover actual multi-day ingredient aggregation, printable/copy integration, private identity collision, imported and priced candidate rejection, missing/duplicate days, frozen inputs, no euro/savings and no exposed basket.

This remains DRAFT / HOLD, never a live store list or current price. M3 source rights #74, human PLUS11/Deka11 #78, source SHA #205, permanent VPS #2833, scoped writer lease and separate owner review still apply.