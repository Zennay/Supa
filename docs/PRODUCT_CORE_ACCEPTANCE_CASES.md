# Product-core acceptance cases — M3

This document is an implementation-ready set of **deterministic product acceptance cases**, not evidence that a retailer's live prices are correct. Do not mark the M3 field-evidence exit gate (#78) complete based on synthetic examples.

## Shared principles

- Compare stores for the **same requested ingredient quantities and units**. Never silently reduce demand to make a basket look cheaper.
- Keep **unknown/unmatched/unavailable** distinct from a genuine price of zero.
- Price an offer only when the offer's conditions, validity window, and required quantity can be established.
- Never infer actual savings from missing or unverified observations.
- Display monetary totals and differences from integer cents; round only for display.
- Include the observation time and source permission status whenever retailer data is shown.

## Cases to convert into executable regression tests

| Case | Input | Expected product behavior |
| --- | --- | --- |
| C01 — identical demand | 2 × 500 g tomatoes required; store A has one 1 kg pack, store B has two 500 g packs | Compare total purchase price for the same 1 kg demand, including whole purchasable packs. |
| C02 — pack rounding | 750 g required; only 500 g packs are sold | Require two packs, not 1.5 packs; identify the 250 g excess. |
| C03 — unmatched ingredient | A matches every ingredient; B cannot match one essential ingredient | Do not claim B has a fully comparable cheaper basket. Expose B's incomplete coverage. |
| C04 — uncertain quantity | Ingredient requested without a resolvable quantity or unit | Keep the line unresolved; do not assume 1 item or 1 kg. |
| C05 — unknown price | A matching product has no validated current price | Treat its contribution as unknown, never €0.00; do not advertise a complete total. |
| C06 — expired offer | Product has a cheaper promotion whose end time precedes observation or shopping date | Exclude the expired promotional price and explain why. |
| C07 — conditional offer | Two-for-one promotion applies only for quantities of two | Do not apply to a one-unit purchase; for two units apply precisely once. |
| C08 — identity collision | Two retailer records share a display name but differ in product identity or pack size | Do not collapse them into one candidate solely by name. |
| C09 — duplicate plan day | The same active planner day appears twice in the input | Do not charge the day's ingredients twice without a clear, intentional duplication rule. |
| C10 — mixed confidence | One store's prices are observed, another store's are fixture/demo data | Do not present their difference as verified real-world savings. |
| C11 — negative/invalid amounts | Price is negative, NaN, infinite, or not an integer number of cents | Reject or mark unresolved; never include it in a computed basket. |
| C12 — deterministic ties | Two fully matched stores have the same cent total | Do not claim either store is cheaper; show a tie with stable ordering. |
| C13 — demand preservation | One candidate store only offers an unsuitable substitution | Explain why the line is unmatched rather than quietly changing the shopping requirement. |
| C14 — time boundary | Promotional offer ends at a precise instant | Define and test inclusive/exclusive boundaries in the offer model; never infer validity from a date string alone. |

## Evidence separation

Synthetic regression tests prove calculations and UI behavior only. The M3 release claim requires the independently recorded genuine PLUS + DekaMarkt **same-demand** observation and permission provenance described by issue #78. Capture the observation timestamp, basket inputs, retailer source/permission, unavailable lines, pack-size decisions, and cent-level arithmetic before issuing any public savings claim.

## Handoff

For each case, identify the existing owning product module and test path **before** converting it into code. Reuse existing fixtures and conventions. If another worker owns that module or an active pull request, leave it alone rather than cherry-picking or duplicating the change.
