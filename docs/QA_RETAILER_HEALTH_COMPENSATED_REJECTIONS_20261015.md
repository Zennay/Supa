# Independent M3 QA — compensated adapter-source deterioration (15 October 2026)

## Frozen proof scope
- Frozen **main**: `ac09ea8bb99d34321983e6639f6c7b2d962a3a38`.
- Owned QA test: `tests/qa-retailer-private-health-compensated-rejections-20261015.test.mjs`.
- Direct public API under test: `comparePrivateAdapterHealth(before, after)` in `scripts/retailer-private-adapter-health-trend.mjs`.
- QA owns only the new test and this note. Does not change another worker's product code, tests, CI, workflow paths, observed retailer data, rights, source adapters or release logic.

## Why a positive control is required
The six real **archived reviewed fixtures** produce one accepted source per each PLUS/DekaMarkt product/catalog/offers kind. QA obtains an authentic aggregate-only health shape from the existing evaluator at a deterministic archival clock. It then creates an internally coherent *fictional diagnostic* with two further reviewed/rejected sources in each of two source-kind buckets. Both before/after retain valid `sources = accepted + rejected` identities, full six-shape acceptance, stable totals, identical operator actions, 0 external requests and every rights/publication flag false. Positive controls compare identical snapshots and must produce zero alarms.

## Independent negative scenarios
1. PLUS product quality deteriorates (one fewer accepted, one extra rejected) while DekaMart catalog improves by exactly the inverse. 
2. DekaMart offers quality deteriorates while PLUS catalog improves by the inverse.

All global counts, products, observations, source and missing-shape status remain identical. In each case the *per-source* `acceptedDelta=-1` and `rejectedDelta=+1` unambiguously indicate a worsening reviewed offline ingestion slot, but the current comparator only emits rejection/acceptance trend signals from global totals. Because it already contains source-specific stale/unknown quality signals, these are independent acceptance tests for analogous compensated rejection/source-admission shifts.

### Product-owner acceptance
- Every negative case should set `datasetRegressionSignalsDetected=true` and include at least one **generic aggregate-only** review signal without revealing retailer names, URLs, product identifiers, SHA, price, time or personal evidence.
- Identical comparison, fully positive history and compensated-baseline positive control remain clean.
- Existing `perShape` deltas, schema, timestamps, privacy-only mode, flags and human-review gate remain unchanged.
- Use the original QA file **byte-identically** against the new product fix SHA, with full hosted Node suite, high-level npm audit, M1 matching and source-permission gates, TypeScript/Vite build.
- This is intentionally independent QA; **do not merge an expected-RED PR**. Independent review + scoped zCloud SQLite lease + applicable permanent VPS PR gate are required for any future integration.

## Release remains on HOLD
The test contains no retailer HTTP, pricing assertions, real shopping baskets or authorization. It does not unblock written source rights (#74), genuine 11+11 store observations (#78), field-run source code pin (#205), or permanent trusted M3 self-hosted path gate (#2833). It does not authorize live scraping, savings publication, production, M4 or M5.
