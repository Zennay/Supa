# Supa M1/M3 — controlled observation → one-store basket bridge

## Scope (issue #168)

This is an **opt-in, preparatory product-core bridge** layered on [draft PR #1138](https://github.com/Zennay/Supa/pull/1138), NOT a live data adapter, retailer scraping route, retailer permission approval or verified M3 field observation. Existing ingestion, retailer source adapters, matching/basket owners, product UI, collector, M3 financial assessment and `main` are deliberately unchanged.

`projectTrustedObservationForBasket(raw, { id, supermarket })` returns a canonical `StoreProduct` **only** when the complete raw product observation and raw quantity pass all strict guards. The caller supplies a controlled target store ID and exact supermarket identity. This function does not infer whether the caller has licensed or consented to retailer reuse.

### Acceptance rules

1. Raw observation and retailer provenance must pass the existing validator (HTTPS official host, matching supermarket, SHA-256 snapshot identifier, valid capture timestamp).
2. The raw pack quantity and unit must agree with the normalized raw text. Multipack count must be a positive safe integer, count × quantity × base-unit factor must remain safe. A future explicit `pack.count` must agree with original text.
3. Product-level source (`provenance.kind === 'product'`), explicit *available* stock, non-null **safe integer** current price in cents and exact nonambiguous source product ID are mandatory. No inferred price, availability or identity.
4. A non-null promotion/offer is deliberately **rejected**. A `2+1`, percent discount or quantity-based offer cannot be flattened into a constant pack price safely without cart-level promo mechanics. The existing `currentPriceCents` is used only when no offer is present. A free zero-cent product is not guessed away.
5. The result contains exactly: `id`, `storeId`, `name`, `available`, `priceCents`, `packAmount`, `packUnit`, `packCount`. Raw URL, timestamps, hash, private notes and identifiers outside stable source product ID are not projected. Inputs are not mutated.
6. A product scoped to one store cannot enter another store basket as a candidate.

### Deterministic synthetic integration proof

A deliberately synthetic PLUS-like HTTPS observation `6 x 1 l` at **199 cents per six-pack**, with a *four-litre* canonical demand, produces **one purchased pack at 199 cents**. Seven litres requires **two purchased packs at 398 cents**, not seven or one. Separate regression cases cover `4 x 0,5 l`, ordinary singles, malformed fields, wrong provenance, unavailable products, unsafe prices and promotions, wrong stores, unrelated retailer URLs and non-mutation.

These fixture values are **never** genuine PLUS/DekaMarkt observed prices or savings; they must never be included in M3 financial proof.

### Remaining integration / release gates

- #117 owner must establish a canonical and source-proven count-bearing `RawPack` contract.
- #122 owners must preserve that value in real PLUS/DekaMarkt/schema.org adapters without violating source-use permission.
- Source policy/retailer consent must permit any intended production data reuse **before** wiring the bridge into ingestion or a product flow.
- A genuine captured, permission-compatible source observation must pass the complete normalized adapter → candidate → basket path (with exact provenance).
- Run fresh exact-head hosted CI plus the necessary permanent M1/M3/VPS gates after source-owner composition and a current-`main` zero-behind review.
- Independently, human M3 field exit #78 still requires **real same-demand 11-product PLUS baseline + DekaMarkt candidate within 24h**; synthetic basket fixtures are not financial claim evidence.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until the above owner and validation conditions hold.
