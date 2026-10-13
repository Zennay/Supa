# SUPA product-core: persisted week → basket consistency (synthetic)

Scope: add-only integration regression on frozen `main` `c36f5c8f71d77cae94663978b51a194e9b183af6`. This is not a new M3 collector, real-world observation, new retailer integration, production claim, or beta release.

The existing App restores `plannerPreferences` and passes one selected set of days/recipes into the one-store shopping basket and the two M3 controlled comparison baskets. A separate React SSR acceptance (`tests/product-persisted-week-react-render.test.mjs`) now loads the real TSX components through Vite and renders the restored App planner and the derived Basket/ShoppingList presentations, detecting divergence beyond pure domain math. The regression in `tests/product-persisted-week-basket-consistency.test.mjs` exercises that real domain composition without changing any feature owner source file:

1. Persist and restore an intentionally reordered two-day week with custom recipes; all three derived baskets must use exactly the same ingredient IDs and physical requirements. Choosing another supported budget must change the preference only, never the physical basket.
2. Persist an intentionally empty week; all baskets must have zero meals, lines and cost, while previous saved shopping checkmarks must not attach to the empty basket. The controlled comparator must return `same` at zero, not a fictional saving.
3. Mark a required product unavailable in one *fictional* comparison store; the calculator must leave that line unresolved and the comparator must produce `unknown`, without a monetary saving or line delta.
4. Change only the supported week budget: checkbox progress for the physically identical basket must still restore. Change a recipe: the physically different basket must not inherit an old checked item, and both comparison stores must still agree on its required demand.

Additional **rendered financial honesty** controls now exercise the real Basket TSX in both directions: an unavailable synthetic product must produce an explicit `unknown` warning rather than a signed price/savings difference; a synthetic more-expensive candidate must be labelled **higher**, not **lower**, and retain the conspicuous no-live-savings disclaimer. The rendered App must also safely restore the documented deterministic default after malformed local planner storage. These checks use controlled test data only and are not observed market prices.

The tests deliberately import the canonical M2/M3 fixtures; no manual retailer requests, HTML captures, product source approvals, participant metadata or live/savings claims are introduced. The check guards a future composition regression, **not** the M3 milestone. The genuine same-demand 11+11 PLUS/DekaMarkt observation remains [#78](https://github.com/Zennay/Supa/issues/78) and must be collected by a human in a shared 24-hour price context.

Review/merge gate: exact-head hosted CI, applicable permanent browser/VPS proof, independent write-lease/preflight and approval from the active product/QA owners. This branch is **DRAFT/HOLD/NO MERGE/NO DEPLOY**, independent from other open product-core feature branches.

## Permanent rendered-browser verification (separate new workflow)

The add-only `tests/product-persisted-week-browser-e2e.mjs` performs a genuine Firefox/geckodriver exercise against the locally built Vite app on the permanent `vps-bb300bba` runner:

- edit two recipes, disable two days, choose the 40-euro budget and verify actual localStorage persisted preferences;
- visit the real basket and require the **controlled-demo / no-live-savings** disclosure;
- check an item, reload and confirm the stored checklist survives;
- change only the budget and preserve that checkmark;
- change a recipe and reject the old checkmark for the now-different physical basket.

The new `.github/workflows/product-persisted-week-vps.yml` has read-only GitHub permissions, bound localhost Vite + WebDriver ports, explicit browser process cleanup, 15-minute timeout, and a retention-limited **synthetic-only** evidence artifact. It does not change existing shared test/workflow files or contact any retailer. An unrun or queued VPS job does not count as a Firefox PASS. Release remains gated by zCloud independent lease/claim, owner review and actual M3 human field evidence.
