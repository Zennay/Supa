# Six-source historical fact-change review (private only)

This is an offline operator diagnostic for the existing PLUS and DekaMarkt product, catalog, and offers adapters. It is **not** a price scraper or a current-price comparator.

## Run

```bash
node --experimental-strip-types scripts/retailer-private-fact-change-review.mjs
node --experimental-strip-types --test tests/product-retailer-private-fact-change-review-20261015.test.mjs
```

The CLI accepts **no** URLs, filenames, network hosts, or source authorization overrides: its only input is the repository's six historical M1 fixtures. Its two identical archival sample batches should show zero changes. For actual private, human-reviewed comparisons, call `comparePrivateRetailerFactChanges(previous, current, { referenceTime })` with separately ingested in-memory offline batches produced by `ingestReviewedBatch`.

Before any comparison, the canonical `evaluatePrivateAdapterHealth` verifies both original batches, including source/retailer identity, price/pack structure, hashes, summary counts and chronological consistency. Product identity is scoped by store **and** source type: PLUS prices are never merged with DekaMarkt, or product-page records with offer-page records. If multiple historic captures exist for a single source product, only the newest *physical* instant is compared (sub-millisecond digits and UTC offsets preserved). An older current-side event or contradictory payload at exactly the same instant fails closed.

The result is **counts only**: added/missing source identities and numbers of changed price, pack, availability, offer, name and URL facts, both aggregate and by six source shapes. It does **not** expose product IDs, prices, offer labels, source URLs, SHA-256 hashes, raw HTML, or customer data.

## Interpretation and remaining boundaries

- A historical fact difference is a human-review alert, **not** evidence of savings, a retailer's published price, a license or price correctness.
- A missing product in the later batch is reported as missing, **not** treated as free, discounted, out of stock or zero-price.
- This feature does not fetch sites, discover selectors, schedule refreshes, enable product publication or change the M1 permission gate.
- The current checked-in M1 rights are still **PLUS permission_required** and **DekaMarkt unresolved**. Real rollout requires documented source rights, permission/scope controls, M3 paired human observations and trusted runner evidence (#74, #78, #205, #2833). Outputs always contain `productionEnabled:false`, `publicSavingsClaimEligible:false`, `livePricesAvailable:false`.
- No cross-retailer automatic matching or basket cost optimization is implied. Product identities are **source-local**; ingredient-to-product matching remains a separate gate.

This review tool is intentionally standalone so the parallel quality-validation worker can independently test its contract without modifying the product-core branch.