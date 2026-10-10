# Private multistore research snapshot audit (M1 feasibility only)

This standalone verifier works with the opt-in research captures in [the M1 multistore runbook](./M1_MULTISTORE_RESEARCH.md). It does **not** fetch retailer pages, scrape a price, verify DOM selectors, grant retailer permissions, or support a public savings claim. Canonical SUPA **M3 ACTIVE** remains the separate genuine same-demand PLUS → DekaMarkt 24-hour human field task [#78](https://github.com/Zennay/Supa/issues/78).

## Offline verification after an approved capture

An approved capture creates a private `artifacts/m1-multistore-research/<source-id>/capture-<timestamp>-<pid>.html` plus its matching `.json`. Both files must remain local, private, and Git-ignored. Do not attach raw retailer HTML, customer data, prices, cookies or full network logs to issues, pull requests or CI.

For one *already captured* pair, take its filename stem without the extension:

```sh
node scripts/m1-research-snapshot-audit.mjs --audit dirk-halvarine capture-1791675600000-1234
```

The timestamp above is an **illustrative name**, not a real capture. Replace the source and stem with an actual locally saved, authorized capture. The script makes **zero HTTP requests**, requires no proxy or credentials, and never prints raw HTML or URLs.

A passing result is `status: "manual-review"` (exit 0), not a trusted retailer price. Any integrity, provenance, size or freshness failure gives `status: "rejected"` (exit 1), or a generic error when source files are missing or are symlinks. Only a registered source/stem pair is accepted; the verifier does not glob arbitrary paths.

## Checks and limits

- Verify exact registered source/store/URL, captured HTTP 200 HTML media type and known direct/approved-fixed-egress mode.
- Verify **SHA-256 of bytes**, exact byte count, bounded body (5 MiB), bounded metadata (64 KiB on disk), and canonical UTC capture timestamp.
- Reject capture timestamps in the future or older than **24 elapsed hours** for this *research-review freshness check*. This cutoff is not the canonical M3 two-retailer financial proof window; they are different contracts.
- Reject symlinked files, mismatched or missing pairs, malformed JSON and path traversal.
- Return only safe reason categories and source identifier, with `semanticVerified:false`, `livePriceVerified:false`, `publicSavingsClaimEligible:false`.

Tests: `node --test tests/m1-multistore-snapshot-audit.test.mjs`. The fixtures are synthetic and cannot substitute for retailer source permissions, actual browser DOM inspection, correct price-context tracking, semantic selector reviews or human field observations.

**Integration remains DRAFT / HOLD / NO MERGE / NO DEPLOY** until M1 source/terms review and exact-head hosted and applicable permanent tests and ownership reconciliation.

## Offline inventory of all saved research sources

After a few explicitly approved captures, run:

```sh
node scripts/m1-research-snapshot-inventory.mjs --inventory
```

The inventory never performs network requests or starts a scraper. It checks every complete private HTML + JSON pair against the same SHA-256/provenance/freshness audit, counts missing pairs, unexpected files and rejected captures, and reports **aggregate counts by registered source identifier only**. It never prints file stems, raw HTML, exact retailer pages, page content, prices or full timestamps. This gives the operator a way to discover which source captures still need manual DOM review without copying any private files to CI or an issue.

Exit codes: **0** means at least one locally stored capture passed only the *synthetic-proof-free M1 integrity review* and there were no rejected/incomplete/unexpected files; **1** means a rejected, incomplete or unexpected capture; **2** means no saved captures. Neither 0 nor `manual-review` authorizes source use, proves DOM selector semantics or establishes live savings. Inventory will not silently ignore unregistered directories, missing JSON partners or stale captures.

Tests: `node --test tests/m1-multistore-research-inventory.test.mjs`. All tests use synthetic private temp directories, not supermarket content.
