# SUPA product-core: persisted week → basket consistency (synthetic)

Scope: add-only integration regression on frozen `main` `c36f5c8f71d77cae94663978b51a194e9b183af6`. This is not a new M3 collector, real-world observation, new retailer integration, production claim, or beta release.

The existing App restores `plannerPreferences` and passes one selected set of days/recipes into the one-store shopping basket and the two M3 controlled comparison baskets. The regression in `tests/product-persisted-week-basket-consistency.test.mjs` exercises that real domain composition without changing any feature owner source file:

1. Persist and restore an intentionally reordered two-day week with custom recipes; all three derived baskets must use exactly the same ingredient IDs and physical requirements. Choosing another supported budget must change the preference only, never the physical basket.
2. Persist an intentionally empty week; all baskets must have zero meals, lines and cost, while previous saved shopping checkmarks must not attach to the empty basket. The controlled comparator must return `same` at zero, not a fictional saving.
3. Mark a required product unavailable in one *fictional* comparison store; the calculator must leave that line unresolved and the comparator must produce `unknown`, without a monetary saving or line delta.

The tests deliberately import the canonical M2/M3 fixtures; no manual retailer requests, HTML captures, product source approvals, participant metadata or live/savings claims are introduced. The check guards a future composition regression, **not** the M3 milestone. The genuine same-demand 11+11 PLUS/DekaMarkt observation remains [#78](https://github.com/Zennay/Supa/issues/78) and must be collected by a human in a shared 24-hour price context.

Review/merge gate: exact-head hosted CI, applicable permanent browser/VPS proof, independent write-lease/preflight and approval from the active product/QA owners. This branch is **DRAFT/HOLD/NO MERGE/NO DEPLOY**, independent from other open product-core feature branches.
