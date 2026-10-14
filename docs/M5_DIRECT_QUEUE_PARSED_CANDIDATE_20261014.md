# Offline M5 direct-queue parsed-candidate provenance

Independent QA finding [#2295](https://github.com/Zennay/Supa/issues/2295) concerns the exported pure `buildOfflineSelectorReviewQueue(report)` API, not the usual `compareInspections` → queue path. The latter already checks that an observation has real parsed JSON-LD. A direct caller could bypass that check by creating an apparently verified snapshot with `schemaOrgStatus:'candidate_observation'` and `jsonLdCount:0,jsonLdParseErrors:0` or `2,2`.

## Own product-core fix (future M5 only)

For any **verified** snapshot with `schemaOrgStatus:'candidate_observation'`, require `jsonLdCount > jsonLdParseErrors` *after* both integers and the 128-record limit are validated. Apply to each current and historical snapshot, not only P2 added or baseline-missing rows. Existing `abstain` with empty JSON-LD/all failures remains valid. Unavailable snapshots have no HTML parse status. Do not inspect private JSON-LD body, prices, names or source URLs.

This is a **necessary but insufficient** origin check: counts alone do not prove Product content, source rights or real prices. The canonical M1 capture inspector and `captureShape` verify deeper provenance before constructing genuine comparison reports. A direct caller remains untrusted even if count shapes are plausible.

Own 16 fictional product regression tests cover P1/P2/P3, both sides, 0/0 and all-errors, exactly one valid parsed descriptor, abstain, real `compareInspections` → queue, private ID suppression, immutability, no retailer HTTP and always-false release/rights. Independent QA owner maintains untouched [original expected-RED #2297](https://github.com/Zennay/Supa/pull/2297); replicate those exact assertions on a *separate QA-only branch* after product fixed source is frozen.

**Release state:** [Supa #78](https://github.com/Zennay/Supa/issues/78) authentic human same-demand PLUS 11 + DekaMarkt 11 observations in ≤24h remain missing: **M3 ACTIVE; M4/M5 INELIGIBLE**. No live retailer collection, permission inference, automated scraping or production deployment. **DRAFT / HOLD / NO MERGE / NO DEPLOY** until independently verified zCloud SQLite scope/task write lease, original owner and QA review, exact hosted full CI, latest-main/trusted runner as applicable, authentic field proof and explicit human release approval.
