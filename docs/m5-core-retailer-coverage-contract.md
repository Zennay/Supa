# SUPA offline retailer inventory — core coverage is not permission

**PWQ-316 / [epic #2069](https://github.com/Zennay/Supa/issues/2069).** This is a **product-core add-only child** of frozen, hosted-green original [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090), SHA `5d8ae48e4df6a5da12c23e9b6750b0ddbfd9ee2f`. The original register, M1 gate, owner branch, QA branches and `main` are unchanged.

## Why this check exists

The owner register already contains **17 research-only Dutch retailer candidate banners, including Boni**. The earlier Notion note that Boni was missing has become stale. The existing owner auditor checks exact schema and fail-closed rights, but purposely permits any nonempty, bounded set of brands. A later edit could silently remove a required retailer while remaining schema-valid. This child adds a **distinct, independent completeness criterion** for the *13 explicitly named banners* in PWQ-316/#2069: Albert Heijn, ALDI, Boni, DekaMarkt, Dirk, Hoogvliet, Jumbo, Lidl, Picnic, PLUS, Poiesz, SPAR, Vomar. Boon, Ekoplaza, Nettorama and Odin are additional candidates, not substitutes for missing core brands. Thirteen is the narrow documented checklist, **not a factual claim about every Dutch banner, store, region, franchise, offer or live source**.

## Offline executable acceptance

```bash
node scripts/m5-check-core-retailer-coverage.mjs
node --test tests/m5-core-retailer-coverage.test.mjs
```

This read-only command first invokes the *original* `assessRetailerDiscovery` audit, then checks core-brand completeness. It reports fixed `contractVersion`, `requiredCount`, `coveredRequiredCount`, `missingRequiredIds` and `additionalCandidateIds`. **Exit 0** means **only** that all 13 public market-inventory candidate IDs are listed in a valid *research-only* register; it is **not** retailer permission, technical source readiness, an ingestion adapter or proof of price availability. A missing core banner returns **exit 2**, an explicit missing-ID list and `coreCovered=false`. An invalid schema, private file or unauthorized flags return opaque nonzero stderr with **no report output**. In all successful or incomplete reports, `rightsVerified=false`, `productionReady=false` and `m5Eligible=false`; these are not user-supplied switches and there is no authorization path.

## Snapshot-change review (second product increment)

The optional offline command `node scripts/m5-check-core-retailer-coverage.mjs current.json --baseline previous.json` performs **another explicit independent schema validation** on each file before comparing candidate IDs. The current and baseline root and source-array objects must be distinct; different object identities are *not* proof of different real collection dates. The result includes `addedCandidateIds`, `removedCandidateIds` and `humanReviewRequired`; a **removed candidate — even an additional brand outside the 13 core** — exits 2 so review cannot silently drop it. An addition is visible but cannot grant source permission. `historicalEvidenceVerified`, `rightsVerified`, `productionReady` and `m5Eligible` are always false. No raw person, price, product, or retailer HTTP data is collected.

Eight extra synthetic tests check identical independent copies, extra-brand removal, additions, array/root alias refusal, guarded accessor failure, and the actual comparison CLI's exit codes. These complement the original 13 cases: **21 new cases in this child PR**.

Thirteen fully fictional tests include missing Boni, missing PLUS+DekaMarkt, a decoy replacement despite same total count, unchanged original object, invalid purpose and permission claims, real CLI output and safe CLI failure. **No retailer URL is fetched**; only original research references in owner data are read locally. No customer/product prices, user IDs, tokens, scraping, proxy use or network requests.

## Roadmap and review restrictions

**Supa M3 ACTIVE.** Genuine [human field #78](https://github.com/Zennay/Supa/issues/78) still requires one PLUS baseline and DekaMarkt candidate for the **same eleven grocery needs, within 24h and one price context**. M4 and M5 are **INELIGIBLE**, as are production ingest and savings claims. The separate permission request path is [#74](https://github.com/Zennay/Supa/issues/74) and Notion PWQ-25.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until the original #2090 product owner and independent QA review, independently verified zCloud SQLite writer/scope lease, exact GitHub-hosted tests and current-main/trusted-runner gates where applicable, genuine human field and lawful source evidence, and explicit release approval. This isolated child does not touch any existing owner files or branch, M1/M3 UI, runner/VPS, workflows or permission status. A future owner can integrate just these three add-only paths once the parent is approved.
