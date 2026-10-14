# M3 user-choice and uncertainty contract

Status: product-core acceptance specification; **not** observed retailer evidence or a public savings claim.

## Purpose

SUPA's product loop ends in an understandable **choice**, not an automatically accepted cheapest-store recommendation. The UI may show a monetary comparison only when the underlying same-demand, whole-pack baskets pass the canonical comparator's claimability gates. It must not silently replace a user's selected store or weekly meal choices.

## Decision states

| State | Display | Permitted action | Forbidden assertion |
| --- | --- | --- | --- |
| Both store baskets complete and comparable | Explicit PLUS baseline, candidate store, whole-basket totals, signed difference, timestamp/context | User may choose either store | Guaranteed future savings |
| Both complete, candidate equal | Neutral result: no proven price advantage for this basket | User chooses using convenience/preference | “Saved money” |
| Both complete, candidate more expensive | Candidate costs more for this frozen basket; show positive extra cost | User may nevertheless select candidate | Hide negative outcome |
| Missing match, pack-size ambiguity, stale/unavailable price, invalid provenance or inconsistent demand | Unavailable/uncertain outcome with reason, missing lines and best next step | Keep planning and shopping-list flow; allow explicit manual store choice | Numeric savings headline or inferred zero |
| User changes recipes, quantities or preferences | Mark previous comparison as applying to its original frozen demand | Recalculate against new demand and source snapshot | Reuse prior comparison as proof for new plan |

## User-facing acceptance scenarios

1. **Never auto-switch:** A complete candidate basket is cheaper, but the user selects the baseline store. The shopping list follows the explicit user choice, while the comparison remains informational.
2. **Worse is visible:** A complete candidate costs more. A positive extra-cost value is not rendered as a saving; choosing it remains possible.
3. **Unknown is not zero:** One product cannot be matched at either store. Show which product and why the comparison is not claimable; do not render €0 saved.
4. **Provenance is visible:** When a comparison is claimable, the user can inspect retailer, region/store scope, observed-at timestamp, applicable offer terms, pack quantity and baseline.
5. **Replanning invalidates comparison:** Replacing a recipe or changing servings invalidates any previously shown price outcome until identical new demand is calculated for both stores.
6. **Untrusted data degrades safely:** If one retailer becomes unavailable, the weekly plan and unpriced shopping list still function. Display the missing retailer/price state instead of extrapolating from mock or stale data.
7. **Whole packs not unit-price fantasy:** Buying 1.2 units of a product sold in packs of one requires two packs unless verified selling mechanics permit otherwise. Show traceable purchased quantities and leftover quantities.
8. **No marketing promotion:** A single genuine M3 field run, regardless of result, is an observation for a defined basket/context, not a general SUPA savings guarantee.
9. **Accessibility:** Outcome text must convey cheaper/equal/worse/unknown independently of green/red color; uncertainty and chosen store must remain distinguishable to screen readers.
10. **Manual override survives reorder:** Reordering basket lines or revisiting the comparison cannot reset the selected store in the absence of an explicit user change.

## Release review

For each scenario record the relevant deterministic fixture/snapshot, trace result and user-visible presentation evidence. Reject an M3 product-choice signoff when any uncertain comparison displays a numeric saving, when a worse basket is presented as cheaper, or when a replan silently retains the former comparison. Do not declare M3 complete until the distinct genuine same-demand PLUS/DekaMarkt field gate [#78](https://github.com/Zennay/Supa/issues/78) is accepted.

Related canonical architecture: [Product & Architecture](https://app.notion.com/p/3e79e19ac95581f0b1b0dca451ea2696). This file intentionally does not edit owned UI/comparator/test surfaces or invent price observations.
