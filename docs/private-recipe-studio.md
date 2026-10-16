# Private recipe studio — controlled review editor plus weekly selection

This add-only product-core composition is stacked above #3285, #3291, #3297 and #3300, with no edits to peer source modules, App.tsx, retailer adapters, QA tests, workflows, main or VPS state.

src/features/user-recipes/PrivateRecipeStudio.ts composes:
- A host-injected, controlled recipe editor component. The intended host component is the existing UserRecipeDraftEditor.tsx from #3274. The host injects it as EditorComponent after resolving App ownership; the studio never edits or imports its JSX implementation in native Node tests.
- The hardened manual draft-to-unpriced-basket projection from #3291. On user confirmation the event-time draft is revalidated, manual-only provenance is enforced, pending warnings/unknown metric amounts/refused IDs never emit an accepted recipe, and only an unpriced private recipe reaches onAddReviewedRecipe.
- The controlled 7-day PrivateRecipeWeekPlanner from #3300, which uses the existing canonical offline ingredient/basket aggregation, price-free copy/print list and no retailer data.

Eight real Node and ReactDOMServer contract tests prove the integrated component renders, callback admission allows a legitimate reviewed manual recipe, imported URL or invalid amount is refused, duplicate IDs cannot overwrite library entries, frozen drafts remain immutable, HTML-like recipe names are escaped, and an incomplete recipe shows an explicit review status.

The parent owns all library state, ID issuance and authenticated account persistence. No in-memory callback is a claim of durable saving. No private recipe is silently published or fetched from URLs. No live retailer price, actual savings, privileged clipboard write or app navigation. No false zero cost; the legacy domain price type must be migrated separately before mounting.

Staged order: #3285 -> #3291 -> #3297 -> #3300 -> this PR. Each change is DRAFT/NONMERGE pending independent product QA #3282/#3283/#3288, active App owner #3088, parser owner #3264, trusted CI and scope lease. M3 ACTIVE/HOLD pending written PLUS/Deka rights #74, human same-demand PLUS11/Deka11 #78, pinned capture code SHA #205 and permanent VPS gate #2833.