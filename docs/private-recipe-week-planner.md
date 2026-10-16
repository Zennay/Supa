# Private personal week planner — staged (not App mounted)

An isolated product-core seven-day manual private-recipe planning path built on the existing reviewed-recipe projection and offline copy/print checklist. It does NOT change peer-owned App.tsx, the M3 comparison engine, retailer adapters or QA workers.

New files:
- src/features/user-recipes/privateWeekPlanner.ts: pure one-week selection, only Ma–Zo, explicit private recipe IDs and own property descriptors, refusing getters, unknown day keys, duplicate recipe IDs and incomplete choices.
- src/features/user-recipes/PrivateRecipeWeekPlanner.ts: accessible controlled React UI with seven labelled selects, user-managed state, known-price disclosure and the existing price-free shopping-list view. No persistence, clipboard permission or network.
- tests/user-recipe-private-week-planner.test.mjs: nine real pure/core/SSR test cases, including two-day cumulative amounts, unchosen state, malicious choices and HTML escaping.

This does not create a user account, recipe database, public recipe importer, source permission, retailer price comparison or M3 savings proof. The host can mount this controlled widget only after the central App owner has reconciled routes and identity. Pricing remains unknown and never becomes zero.

Stacked PR order: #3285 -> #3291 -> #3297 -> this isolated PR. Do not merge precursor branches twice. Other active owners #3264 JSON-LD and #3088 App remain untouched. Independent QA gaps #3282, #3283, #3288 still require their own fixes.

Native exact-head CI is required. Release M3 HOLD: #74 written rights, #78 genuine PLUS/Deka 11x2 <=24 hours, #205 source SHA, #2833 permanent VPS, scoped writer lease and needed reviews. No live retailer calls or price/saving claims.
