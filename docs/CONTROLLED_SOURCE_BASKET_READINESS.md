# Controlled source-only basket comparison readiness (product-core)

This is an **opt-in structural product-core bridge** between the controlled two-retailer observation projection and the existing canonical M2 one-store basket / full-basket comparator. It adds no live retailer adapter, no automatic collection, no new UI savings claim and no permissions.

## Why

The predecessor proof in #1147 exercises all eleven demands using **one real projection shape plus leftover M2 fixtures**. That is a useful arithmetic regression but it can hide missing product coverage when someone tries to treat controlled source observations as a complete shop. The new `assessControlledSourceBasketReadiness` deliberately consumes **only** products created from the supplied, individually provenance-validated and 24h-fresh store observations. It has **no fixture fallback**.

## Contract

1. The caller explicitly supplies two different source-bound stores, their display names, the meal plan, recipes, active days, a reference clock, and complete product-level observations for each retailer.
2. The existing pack-count/provenance, strict freshness and non-promotional gates are applied to the **entire** catalog pair.
3. Both one-store baskets are built via the existing production domain algorithm from the **same demand**, but using only the corresponding controlled products.
4. An empty selected week, missing recipe, an incomplete ingredient on **either** side, unmatched/ambiguous products, or a structurally unknown basket comparison returns a generic `structural-fail`. It never returns a misleading lower total for a partial basket.
5. `structural-pass` exposes both basket traces, an internal comparison outcome and a cents-exact **candidate-minus-baseline** difference. It is still `releaseEligible: false` by design. It exposes no `savingsCents` or `claimable` field, to avoid mistaking simulation arithmetic for a consumer savings assertion.
6. Unexpected runtime shapes/exceptions fail closed without echoing participant names, source URLs, or thrown exception messages. Inputs are not modified.

The new tests use entirely **synthetic** retailer-shaped records, including `6 x 500 g`, missing ingredient coverage, malformed sources, 24h boundary/offset equivalence, empty weeks and hostile accessors.

## Explicit non-goals / release gate

- It does **not** fix count loss in original ingestion/adapters (owners #117 and #122 / issue #168), check licensing or authorize automated use of PLUS/DekaMarkt data.
- It is not wired to real field intake or consumer-facing prices. No simulated arithmetic may be marketed as saved money.
- Genuine #78 remains **OPEN** and requires one human-observed same-demand 11×2 pair, PLUS baseline and DekaMarkt candidate, same price context, within 24 hours, followed by canonical converter + assessment.
- This is a new-file-only, isolated **DRAFT/HOLD / NO MERGE / NO DEPLOY** stack on the reviewed precision-loss source repair #1150. Do not modify #1147, #1150, their independent QA branch, the existing retailer/collector/comparator owners, or `main`.
- Exact-head hosted CI, permanent relevant M1/M3/VPS validation and original owner approval remain required before any integration.
