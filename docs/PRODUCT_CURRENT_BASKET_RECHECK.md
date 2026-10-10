# Current-basket comparison recheck (product-core #1065)

Status: integration-ready helper, **not connected to BasketView or the in-flight comparison card**.

## Why this exists

`BasketComparison` contains line IDs, labels and cent totals, but not a complete
serialized identity of the demand/pack inputs. A comparator object calculated
before a planner edit can therefore pass superficial line-total consistency
checks even after ingredient requirements change.

`compareCurrentBaskets({ baseline, candidate })` deliberately has **no
parameter for a previously cached report**. It calls the existing canonical
`compareFullBaskets` on the two **current** snapshots and returns a newly
calculated claimable report or `null` (no claim). There is no parallel money
engine, new source of prices or inferred savings.

## Owner integration contract

The active `comparisonNextStep.ts` product owner (PR #1063) and BasketView owner
(PR #319/#118) can use this after coordinating ownership:

1. Rebuild baseline and candidate baskets from the same *current* planner demand
   and chosen product catalogs. Do not pass a cached basket after a plan edit.
2. Call `compareCurrentBaskets({ baseline, candidate })` at the point a
   financial comparison is to be rendered, not once at app startup.
3. If the result is `null`, **do not show a price delta or savings claim**.
   Route to the existing incomplete/empty/plan-alignment/review action.
4. If non-null, send that **fresh** result to `comparisonNextStep` and the
   existing basket trace UI. Never continue displaying the old report.
5. Recheck after a change in active days, recipe, ingredient demand, chosen
   product, store identity, price, pack count/size or match status.
6. Keep the current M3 evidence/price-source permission gate. Synthetic fixture
   arithmetic is not a real PLUS/DekaMarkt saving.

The helper purposefully returns `null` rather than fabricating an "unknown"
monetary summary when runtime basket structure is malformed. A malformed nested
pack can still throw inside the existing comparator; this boundary catches that
error and prevents a user-facing money claim.

## Proof and remaining limitations

`tests/product-current-basket-recheck.test.mjs` runs the real M2 basket builder,
canonical comparator and recheck helper across better/same/worse outcomes, stale
single-store demand, changed prices, malformed nested packs, empty weeks,
incomplete catalogs, asymmetric plans, self-comparison and mutation invariants.
Tests use **synthetic** products and prices.

This is an additive, owner-disjoint building block. Until the active UI owner
uses it, it **does not fix existing rendered BasketView behavior**. The helper
cannot know whether its own supplied *basket objects* are stale: callers must
always rebuild both snapshots from the latest planner state. Genuine M3
same-demand PLUS + DekaMarkt observation (issue #78) is still outstanding.
