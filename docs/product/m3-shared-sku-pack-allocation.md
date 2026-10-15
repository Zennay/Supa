# M3 shared-SKU pack allocation (offline preview)

Supa previously abstained from a basket winner whenever two different ingredient IDs selected the same physical supermarket SKU. That avoided double billing but hid a potentially useful comparison. The M3 reviewed-catalog comparator can instead combine those demands **per supermarket**, before calculating whole purchasable packs.

## Worked fictional example

One breakfast demand needs 400 ml of halfvolle melk and one dinner demand needs another 400 ml. The same source product is sold in a 1,000 ml pack. For fictional PLUS 129 cents and DekaMarkt 119 cents:

| Output | PLUS | DekaMarkt |
| --- | ---: | ---: |
| First ingredient (shared purchase owner) | 1 pack / 129c | 1 pack / 119c |
| Second ingredient (already covered) | 0 **additional** packs / 0c | 0 **additional** packs / 0c |
| **Physical purchase** | **1 pack / 129c** | **1 pack / 119c** |

A 10-cent **synthetic offline difference** is not a verified live store saving. Supa keeps `claimable: false` and must not promote a public savings assertion without genuine authorized field evidence.

## API meaning

The original `lines[]` retain their individual ingredient IDs and status. To avoid treating an ingredient with a 0c *additional* cost as a free supermarket product, the charged row has `sharedPackCoversIngredientIds` listing all ingredient IDs served by the pack purchase. A later covered row has `sharedPackWithIngredientId` pointing to the original charged ingredient. Consumers **must** explain the relationship when presenting individual prices; simply displaying “€0,00” without “covered by shared pack” is misleading. `packPriceCents` stays the real price of the full physical pack on *both* rows; only `packs` and allocated `totalCents` become zero on covered rows. `differenceCents` is recomputed from allocated costs and therefore the covered row has a zero incremental difference.

Each retailer is allocated separately: the same ingredient may match a different SKU in another shop, and that retailer's grouping must be calculated independently. Packing is rounded **after** aggregating the original demand quantities using `calculateDecimalPackCount` and decimal/physical unit conversion (e.g. 0.4l plus 400ml). Invalid unit, unknown stock, ambiguous match or unsafe total must still withhold a full comparison/winner. Group allocation follows input ingredient order and must not alter source observations.

## Acceptance and permissions

- Preserve original independent same-SKU safety regressions (issue #2635) without changing QA-owned assertions.
- Run complete hosted `npm test`, high audit, matching/source-permission gates, and TypeScript/Vite build on the exact proposed branch and then integration SHA.
- Do not activate retailer scraping, bypass permission requirements or describe fictional prices as actual PLUS/DekaMarkt prices.
- M3 remains a private, unpublished product candidate until original owner/scope approvals, permanent runner checks and real same-demand PLUS11/DekaMarkt11 observations are complete.
