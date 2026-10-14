# Future M5: Product-capable JSON-LD provenance (synthetic proof only)

Issue [#2293](https://github.com/Zennay/Supa/issues/2293), independent product-core child of frozen exact hosted-green [#2289](https://github.com/Zennay/Supa/pull/2289) at `0de2b03bc8ced33f88dfbadb57c59a920c45061a`. Own code/tests; no upstream branch or independent QA edits.

## Why

An accepted positive Schema.org parser decision plus *any* valid JSON-LD was insufficient: unrelated parsed `WebPage`, `Offer` or `ItemList` shapes can never produce M1's positive Product observation. Such a synthetic contradiction would be treated as a positive candidate by the pure future M5 reviewer. Canonical M1 `parseSchemaOrgProduct` only derives a Product from a direct `@type` (case insensitive) or nested `@graph`.

## Bound and acceptance

A positive pure `schemaOrgProduct.type='observation'` now requires its existing own real observation object **and** a successful JSON-LD descriptor which either contains `Product` in `type` (case-insensitive) or `@graph` in `keys`. Do not inspect serialized product values, prices, names, URLs or personal identifiers. This is a *necessary but not sufficient* provenance condition; an arbitrary `@graph` can still be unrelated. Canonical M1 parsed evidence and human review remain authoritative. Direct fictional Product, lowercase Product, `@type` arrays and real nested graph Product must remain valid; unrelated records, even multiple valid records, cannot impersonate a Product.

Regression in `tests/product-m5-product-type-provenance-20261014.test.mjs` uses local invented HTML + real M1 `inspectHtml` and `parseSchemaOrgProduct`; checks P1/P2/P3, privacy, failed-source P1 and fail-closed release/rights. No real retailer requests or product prices. Do not merge or deploy until separate zCloud SQLite lease, original owner and independent QA review, exact SHA hosted green and latest-main/trusted runner checks when applicable, actual human [M3 issue #78](https://github.com/Zennay/Supa/issues/78) same-demand 11 PLUS + 11 DekaMarkt observations within 24 h, source rights, and explicit human go. **M3 ACTIVE / M4-M5 INELIGIBLE / DRAFT HOLD**.
