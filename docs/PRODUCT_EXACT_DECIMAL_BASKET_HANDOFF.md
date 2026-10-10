# Exact-decimal basket composition: owner handoff (#1053)

Status: **product-core pre-integration**. Branch is stacked on existing
[#1054](https://github.com/Zennay/Supa/pull/1054), not on main.
The `src/domain/basket.ts` owner remains [#273](https://github.com/Zennay/Supa/pull/273).

## What is new?

The canonical basket builder currently sums 0.1 and 0.2 as
`0.30000000000000004`, which buys a phantom second 0.3 pack at 199c
per pack and overstates the controlled basket at 398c.

`buildExactDecimalOneStoreBasket()` takes the original planner and recipes,
uses the original canonical product matching/basket result, and recomputes the
exact aggregated demand and whole-pack count from the **original fragments**
using #1054's `sumDecimalAmounts()` and `calculateDecimalPackCount()`.
It then reconstructs only the amount/pack-count/cent trace on matched lines,
preserving price-source and unresolved-product honesty.

If the corrected demand would choose a different product, fails validation,
or monetary totals overflow, the function returns `null` instead of guessing.
It never fills missing products or promotes a missing price into a free basket.

## Integration contract

1. Review with owners #273 (basket engine) and #342 (planner). Prefer to wire
   exact aggregation and pack arithmetic directly in the owning canonical
   basket builder; this compositional adapter is a **working reference**.
2. Avoid using already-rounded sums with the decimal helper. Pass each
   original recipe requirement before any JS binary addition.
3. Keep chosen product and exact cents linked to the same updated demand;
   do not infer real retailer availability/freshness from synthetic fixtures.
4. Re-run independent [QA #1092](https://github.com/Zennay/Supa/pull/1092)
   on the **integrated canonical basket fix**, plus permanent Firefox/VPS/
   mobile gates, before closing #1053 or displaying savings.
5. Do not expose this draft as customer-visible integration. M3 still requires
   real same-demand PLUS+DekaMarkt evidence within 24h (#78).
