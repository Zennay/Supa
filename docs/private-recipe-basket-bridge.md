# Private recipes to the existing basket domain — staged integration

Status: DRAFT / HOLD. Based on composite product PR #3285, and file-disjoint from its implementation as well as QA 2/2 and peer JSON-LD parser #3264.

New product module: src/features/user-recipes/reviewedRecipeBasketBridge.ts.

- Fully reviewed MANUAL drafts become unpriced basket candidates: deterministic namespaced recipe and ingredient IDs; grams, millilitres and pieces retained; provenance explicitly local manual review; estimatedCost is null and priceStatus is unknown.
- No guess at product prices or amounts. Missing quantities, warnings, preparation time, invalid query, duplicate ID and imported-URL sources fail closed.
- Existing domain/basket.ts aggregation and matching remain the single engine. Eleven independent new offline node tests include actual cross-module aggregation and basket unresolved-line propagation.
- Tests exercise a fixture-only 5-euro shim because the legacy RecipeWithIngredients domain interface requires a number. This shim is ONLY a test adapter. Do not add it to production or turn an unknown price into a zero-price or verified-savings claim.
- Projection contains no source URL, cooking steps or mutable draft reference. All stay local to the original review draft.
- THIS DOES NOT mount the candidate in App.tsx, persist an authenticated user recipe, grant server-side import/fetch permissions or authorize retailer crawling.

Integration prerequisite: make existing RecipeWithIngredients.estimatedCost nullable in a separate reviewed domain+UI migration, render price explicitly unknown, only then mount a private recipe selector in the planner using authenticated account identity and durable storage. Avoid editing App.tsx while M3 App owner PR #3088 is active.

Evidence: node --experimental-strip-types --test tests/user-recipe-unpriced-basket-bridge.test.mjs, full native GitHub CI on exact branch commit and independent review.

Release gates: M3 ACTIVE/HOLD. Retained external blockers include explicit retailer rights #74, human matched PLUS/Deka 11x2 #78, field SHA #205, permanent VPS #2833, scoped lease and authorized deploy. No public/live price or savings claims.
