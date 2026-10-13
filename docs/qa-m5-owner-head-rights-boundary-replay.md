# QA handoff — M5 rights and review-pack cross-format replay (frozen product)

**Original product:** [PR #2090](https://github.com/Zennay/Supa/pull/2090), frozen exact revision `2704fbec375c13b34c4c54570b0713f26a427f27`. **Existing QA finding:** [#2097](https://github.com/Zennay/Supa/issues/2097), earlier red test [#2098](https://github.com/Zennay/Supa/pull/2098) against a now-outdated source. This branch is an isolated **follow-up**; it does not touch any original product, M3/M4, workflow or other QA files.

Run `node --test tests/qa-m5-owner-head-rights-metadata-replay.test.mjs tests/qa-m5-owner-head-independent-output-oracle.test.mjs`.

## Evidence boundaries

- **Four new expected GREEN tests** independently reconcile the canonical 17 market candidates across `assessRetailerDiscovery`, JSON review pack, RFC4180-style CSV, Markdown, and the real M1 two-retailer permission source. They require sorted one-to-one identities, two historical M1 technical sources (not rights), all 17 disabled, preserved raw input and explicit unknown rights.
- CSV oracle parses escaped quoted cells independently; checks each output row maps back to identical source ID, name, market-list URL, unknown rights and no production mode. Markdown oracle verifies exactly 17 disabled entries and no license assertion.
- Status oracle uses **current owner contract**: discovery lists may contain only `unreviewed`; `denied` and `permission-requested` belong to separately reviewed evidence and must be refused by the source inventory. This supersedes obsolete expectations from the older frozen #2098 QA.
- **Eleven issue #2097 replay tests:** two positive and nine intentional expected RED demonstrating that unrelated production/permission-like root or per-retailer properties or a forged `purpose` are ignored by the frozen source. This is a governance/schemas ambiguity, not any real permission or live ingest. The real CLI rejection case uses only a disposable temp file and no endpoint access.
- Review only; the suite deliberately cannot be merged while it has expected RED. A source-owner patch must explicitly define safe top-level and record metadata and exact research-only `purpose`, rerun correct HEAD with **all tests green**, then complete independently authorized zCloud preflight/write lease, compatible VPS validation and explicit release approval.
- Genuine M3 field [#78](https://github.com/Zennay/Supa/issues/78) is still OPEN. No genuine retailer observations, scraper, proxies, source requests, rights approval, real people or public savings.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
