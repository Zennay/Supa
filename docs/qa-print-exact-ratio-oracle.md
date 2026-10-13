# Independent QA: printed grocery pack quantity exactness (Supa #2077)

**Scope:** regression-only child of the frozen product-print commit `839b5eba6227c96f0dcc654838c5fa12cad72214` from [product draft #2068](https://github.com/Zennay/Supa/pull/2068). Do not rebase, write to or merge the active product-owner branch or the earlier independent [QA #2071](https://github.com/Zennay/Supa/pull/2071).

## Why independent

The product owner replaced lossy floating-point `Math.ceil` with decimal BigInt pack capacity algebra. Previous QA #2071 pinned an older implementation and cannot prove the new calculation. The new file `tests/qa-print-exact-ratio-independent-oracle.test.mjs` exercises the **real product function** `preparePrintableShoppingChecklist`, using the same canonical fictional M2 store/planner basket.

The test oracle is deliberately distinct from the product code: all arithmetic runs on **whole integer tenths** of grams or milliliters, calculating `minimum = floor((requiredTenths + packTenths - 1) / packTenths)`; the product instead parses decimal string exponents to BigInt fractions and cross-multiplies them.

Four executable test groups cover:

- 4,368 combinations across mass and liquid families, alternate g↔kg and ml↔l encodings, fractional packs (0.1 units etc.) and multipacks (1/2/5). Every **exact minimum** must print confidently, one extra pack must be flagged manual and one fewer pack (where possible) must remain manual.
- Independent integer piece-pack minima with Dutch piece nouns and overbuy rejection.
- Incompatible physical unit-family combinations must be unresolved/manual, not a trusted physical purchase.
- Changing price-only evidence must not change paper rows or `needsReview`. This validates the physical/financial separation.

Additional invariants per generated line: no mutation of the source basket, preserved item count/order, accurate manual review count, demo labelling, and no direct financial/participant schema export.

## Boundaries

This is synthetic M2 **fixture-only** QA. No genuine retailer observations, network requests, personal data, price acquisition, beta users, public savings claims, routed App acceptance or permission grants are implied. Existing isolated hosted Firefox-PDF evidence on #2068 tests the standalone component, *not* the real shopping route.

Release decision remains **DRAFT / HOLD / NO MERGE / NO DEPLOY** until independent zCloud lease/preflight, owner approval, latest-main composition, exact-head CI/appropriate permanent VPS gates, real routed screen proof and explicit go. Human M3 [#78](https://github.com/Zennay/Supa/issues/78) stays OPEN; M4 is ineligible.
