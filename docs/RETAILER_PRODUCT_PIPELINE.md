# Supa — supermarket product ingestion and comparison foundation

This is implemented code, **not** a live-price claim or approval to scrape. The current source-rights registry has PLUS `permission_required` and DekaMarkt `unresolved`; production ingestion remains disabled. Existing product/UI PR #2614 owns the consumer-facing Vergelijk view and independent QA #2616 owns its verification. Do not overwrite those branches.

## Working pieces

- `scripts/retailer-snapshot-adapters.mjs`: extracts Product JSON-LD from bounded, previously captured/local HTML and delegates price, availability and packaging to the existing `parseSchemaOrgProduct` trust gate. This is the product-page adapter; existing `plusRenderedListings.ts` and `dekaMarktSsrListings.ts` handle the different catalog/offer evidence formats.
- `src/domain/reviewedCatalogComparison.ts`: maps source observations through existing safe ingredient matching and exact decimal pack-count arithmetic. The same requested ingredient quantity gets whole-pack pricing at both shops, including unknown/missing items, individual price difference and basket winner only for complete, fresh, unambiguous two-shop snapshots. Every result is explicitly labeled `offline-snapshot-preview`, `claimable:false`.
- `scripts/retailer-authorized-fetch.mjs`: a **disabled-by-default** bounded, direct-HTTPS capture primitive on the pre-existing, fixed source allowlist. It validates the entire rights gate *before* network access, requires explicit `enableLive:true`, refuses redirects/403/429, streams only HTML up to 2 MiB, no cookies/auth, no retries, no proxy bypass.
- `scripts/retailer-proxy-pool.mjs` already implements offline proxy candidate sanitation, health/quarantine/cooldown logic. This new pipeline intentionally does not route retailer requests through public proxies. A proxy is not permission or a way around rate limits.

## Next integration steps

1. Obtain documented per-retailer reuse permission or licensed feed, update the existing rights register through normal review, and satisfy M3 field evidence and zCloud task-lease/release gates.
2. Collect only explicitly approved product sources using `fetchAuthorizedRetailerHtml`; use existing rendered-PLUS and SSR-Nuxt DekaMarkt evidence parsers for catalog routes. Review selector drift, capture hashes and expiration.
3. Connect the locally reviewed observations to the existing Vergelijk UI after its owner merges #2614. Never automatically promote a snapshot preview to genuine savings evidence; the canonical M3 11+11 field assessor still owns that claim.
4. Run CI on the exact branch/PR head, then the VPS runner and legitimate source smoke tests before any live rollout. No production schedule is enabled by this change.

## Validation

`npm test` includes synthetic tests in `tests/retailer-catalog-pipeline.test.mjs`. It covers two whole packs for 1.5 liters, line/basket cent parity, 0-euro/equal cases, missing/stale/duplicated products, bounded HTML parsing, blocked rights, no unexpected network calls and truncated-stream rejection.


## Local executable comparison (no retailer network)

The input is one local JSON manifest and two or more existing HTML snapshots; run:

```sh
node --experimental-strip-types scripts/retailer-compare-local-snapshots.mjs manifest.json --out comparison-private.json
```

Example manifest structure (fictional; use locally captured or licensed source HTML files):

```json
{
  "version": 1,
  "requirements": [
    { "id": "milk", "query": "halfvolle melk", "amount": 1500, "unit": "ml" }
  ],
  "snapshots": [
    { "sourceId": "plus-product-halfvolle-melk", "htmlFile": "plus.html", "capturedAt": "2026-10-15T09:00:00Z" },
    { "sourceId": "dekamarkt-product-halfvolle-melk", "htmlFile": "deka.html", "capturedAt": "2026-10-15T09:30:00Z" }
  ]
}
```

Requires two product-page JSON-LD snapshots with a recognizable Product name/SKU, EUR Offer, availability and pack size. Missing/malformed/stale prices result in unknown, not invented winnings. The local CLI refuses unsafe file names, outside-directory paths, symlinks, oversized files and duplicate pinned source IDs; `--out` exclusively creates a new `0600` report. Neither CLI nor tests access any supermarket. All prices remain provisional offline previews.
