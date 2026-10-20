# M3 private retailer rollout: historical product conflicts

The six offline reviewed PLUS/DekaMarkt adapter shapes are **historical**, even when all six are accepted. **The bundled six-shape history already contains conflicting product facts; do not assume the untouched fixture is conflict-free.** An accepted capture can contain a competing fact for the same product: price, offer, pack or availability. Shape coverage is therefore not a consistency verdict.

## Operator interpretation

Run the bounded local reviewed-fixture report:

```bash
node scripts/retailer-private-source-rollout-matrix.mjs
```

The report compares the per-retailer catalog conflict decisions with canonical adapter health. If a retailer has a conflict, **only that retailer** receives `review-conflicting-product-facts` in `nextActions`. The other retailer is not flagged unless its own accepted history is inconsistent. This is a mandatory manual investigation; do not silently select the newest incompatible archived fact as a verified price.

The report includes `historicalConflictingProductCount` per retailer and as a reconciled overall count. These numbers represent distinct inconsistent **archived** catalog product groups needing human review, not validated current products or store prices. They reveal no SKU, name, source URL, timestamp or snapshot hash. The sum of retailer counts must match the top-level count.

Other actions for missing source shapes, rejected captures, staleness and written permissions stay independent. All output remains review-only and omits product identifiers, exact prices, origins and private source hashes. Historic captures do not establish current shelf or checkout prices.

## Regression and independent acceptance

- `node --test tests/product-m3-rollout-per-retailer-conflict-20261016.test.mjs` uses cloned sanitized fixture data, two fictional conflicting captures, and checks catalog-backed baseline review, injected PLUS/DekaMarkt changes without altering unrelated store actions, both-store changes, and forged production permission. Baseline status is derived from real historical catalog facts, not from a fabricated conflict-free expectation. It also checks source-permission and publication denials.
- Independently replay the **unchanged** QA evidence in [#3301](https://github.com/Zennay/Supa/pull/3301) against the fixed product head. That original RED/now expected GREEN is separate from the newly authored product tests.
- Review and applicable exact-head hosted/VPS CI still precede integration into `main`. Do not merge QA drafts solely because a suite turns green.

## Release separation

This work performs no retail HTTP requests, scheduled scraping, proxy rotation, authenticated access, database mutation, or public price/savings publication. Written PLUS/DekaMarkt rights [#74](https://github.com/Zennay/Supa/issues/74), human same-demand 11×2 capture [#78](https://github.com/Zennay/Supa/issues/78), field-code SHA [#205](https://github.com/Zennay/Supa/issues/205), self-hosted runner coverage [#2833](https://github.com/Zennay/Supa/issues/2833), and scoped zCloud main-writer lease remain separate gates.
