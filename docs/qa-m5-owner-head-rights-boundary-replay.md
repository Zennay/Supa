# QA handoff — M5 unknown rights-metadata reproduction (frozen product)

**Original product:** [PR #2090](https://github.com/Zennay/Supa/pull/2090), immutable source `2704fbec375c13b34c4c54570b0713f26a427f27`. **Existing issue:** [#2097](https://github.com/Zennay/Supa/issues/2097). This new QA replay is independent of earlier [#2098](https://github.com/Zennay/Supa/pull/2098), which targeted older owner source.

## Expected-RED reproduction only

Run `node --test tests/qa-m5-owner-head-rights-metadata-replay.test.mjs`.

**Eleven offline tests:** two positive controlled-market-list checks, nine deliberate expected RED cases. The nine negative cases exercise unrecognized rights flags (top-level `productionEnabled`, `permissionGranted`, `ingestReady`, `licenseVerified`; per-retailer `ingestAuthorized`, `licenseApproved`, `proxyOverridePermitted`), forged top-level production `purpose`, and the real audit CLI with a misleading local synthetic input file. The owner validator currently checks a fixed set of fields but silently accepts contradictory unrelated metadata. The derived `productionReady` remains false: this is **governance/schema ambiguity**, not active source access.

Four **independent green** cross-format and M1-rights tests now live in separate [DRAFT #2100](https://github.com/Zennay/Supa/pull/2100) and are intentionally absent from this RED branch so the two PRs can be reviewed independently. Its current-owner `unreviewed`-only discovery status acceptance is not overwritten.

A source-owner patch must validate an explicit, versioned allowed schema and exact research-only `purpose`. Do not touch or fast-forward the owner's active branch from this test-only PR. No retailer network, scraping, proxy, human data, real permission, genuine prices or public savings claims.

After owner remediation require independent zCloud preflight/lease, all-GREEN corrected source HEAD hosted & applicable permanent VPS, latest-main composition, source-owner review and explicit human release approval. M3 real PLUS + DekaMarkt [field #78](https://github.com/Zennay/Supa/issues/78) OPEN; M4/M5 ineligible.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
