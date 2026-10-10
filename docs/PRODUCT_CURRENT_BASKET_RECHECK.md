# Current-plan / basket comparison recheck (product-core #1065)

Status: **tested integration candidate**, not yet connected to the concurrently owned
`BasketView` / `comparisonNextStep` surfaces. No live retailer evidence.

## Why

A stored `BasketComparison` has ingredient IDs, labels and integer-cent totals,
but not a complete binding to its original recipe demand, active days, packs and
product-price snapshot. Reusing it after changing the planner can make stale
financial guidance appear valid even when its old totals still agree.

This isolated lane adds two deterministic, fail-closed domain functions. Neither
reads browser state, changes prices, implements savings independently or writes
a plan.

### Preferred: rebuild from a **single current planner snapshot**

`compareCurrentPlannedBaskets(input)` takes the same active days, plan and recipes
for *both* stores, plus each store's independent catalog. It invokes the actual
`buildOneStoreBasket` twice before recomputing with the canonical
`compareFullBaskets`, all synchronously. It **never accepts cached baskets or
a cached comparator report**.

Example for the BasketView owner, after adapting props to the owning UI:

```ts
const result = compareCurrentPlannedBaskets({
  plan: currentPlan,
  recipes: controlledRecipes,
  activeDays: currentActiveDays,
  baseline: { store: selectedBaselineStore, products: baselineProducts },
  candidate: { store: selectedCandidateStore, products: candidateProducts },
})

const moneyClaim = result?.comparison ?? null
// Render the two basket traces from result?.baseline / result?.candidate.
// Render a money difference only when moneyClaim !== null.
// Re-run with the latest inputs after EVERY planner, pack, price or store edit.
```

The result distinguishes:
- **`null`**: malformed/unusable snapshot (including duplicate active days,
  invalid restored plans or invalid catalogs); no financial output.
- **`{ baseline, candidate, comparison: null }`**: valid-to-show empty or
  incomplete baskets, but comparison is not claimable.
- **`{ baseline, candidate, comparison }`** where comparison is non-null:
  the canonical comparator validated a nonempty matched basket pair, with
  exact signed cents and line trace. Display only as *controlled catalog
  comparison*, not evidence of real retailer savings.

The helper rejects duplicate active days before the current basket engine
can inadvertently treat duplicates as a different selected week. Invalid plan
metadata and thrown runtime errors fail closed.

### Secondary: independently rebuilt basket snapshots

`compareCurrentBaskets({ baseline, candidate })` accepts already built baskets
and re-evaluates the existing canonical comparator instead of trusting a
cached `BasketComparison` argument. This is appropriate only when an upstream
owner already guarantees that **both baskets** came from the *same latest*
planner inputs. It cannot detect a stale basket object by itself.

## Required integration and ownership

The owners of PR #1063 (comparison guidance), PR #319/#118 (BasketView), PR #342
(planner domain), PR #273 (basket engine) and PR #1012 (canonical comparator)
retain their files. The PR in this lane introduces only new domain/test files
and this handoff document; **do not cherry-pick overlapping UI changes**.

1. Supply one atomic latest-plan input for both store baskets.
2. Recreate both baskets and compare after changing recipe, selected days,
   ingredient demand, selected product, pack size/count, store or price.
3. If result is null or `result.comparison` is null, suppress *all* displayed
   financial differences (including a previously rendered old difference).
   Keep empty/unresolved basket lines visible and guide the user.
4. Do not cache or reuse an old `comparison` through a subsequent render or
   persisted planner state. This contract relies on callers passing genuinely
   current input objects.
5. Do not treat a valid synthetic fixture comparison as permission to ingest
   retailer data or as a real-world savings observation. Provenance/freshness
   and retailer source permission remain separately gated.

## Deterministic proof, not a release claim

- `tests/product-current-basket-recheck.test.mjs` exercises stale demand,
  repricing, empty weeks, partial stores, malformed pack metadata,
  nonmutation and comparison direction on actual canonical M2 baskets.
- `tests/product-current-planned-comparison.test.mjs` exercises one-snapshot
  rebuilding across recipe/day edits, pack-price refresh, catalog completeness,
  invalid restored plan JSON, input-order independence and unchanged inputs.
- Hosted CI gates must validate the final exact commit: npm ci, dependency
  audit, full Node tests, benchmark, source-permission gate and production
  TypeScript/Vite build. VPS/mobile/Firefox remain separate gates.
- Real PLUS+DekaMarkt same-demand within-24h observation in issue #78 remains
  the M3 exit criterion; do not mark it complete based on these synthetic tests.

Until the owning UI integrates the helper and passes rendered browser/mobile
verification, **current on-main consumer behavior is not fixed by this PR**.
