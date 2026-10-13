# Independent M5 scalar inspection metadata postrepair replay (13 October 2026)

## Milestone and ownership

Supa remains **M3 ACTIVE**; the authentic human same-demand 11+11 PLUS/DekaMarkt basket comparison [#78](https://github.com/Zennay/Supa/issues/78) is OPEN. M4/M5 are not production eligible. All samples and tests are synthetic local/offline, with no retailer requests, permissions, observed basket savings or people involved.

Frozen corrected product [DRAFT #2154](https://github.com/Zennay/Supa/pull/2154), SHA `4e63910aa3eaabf5ce27c4aa5797c8223791752e`, an isolated owner fix for independent [QA issue #2152](https://github.com/Zennay/Supa/issues/2152). New frozen QA base `qa/frozen-m5-scalar-postrepair-4e63910a-20261013`, separate QA-only branch `qa/m5-original-eight-scalar-postrepair-20261013`.

Original **eight tests copied byte-for-byte** from independent [DRAFT QA #2153](https://github.com/Zennay/Supa/pull/2153), original Git blob `bd933f6ce843a614f7b3478956864fc5bd198426`. New test path `tests/qa-m5-inspector-eight-unchanged-postrepair-20261013.test.mjs` retains all five original strict RED and three positive controls verbatim; no weakened expectations or skipped cases. Only this new QA file and documentation added. No owner source/tests, prior QA, other workers, main or workflows altered.

Original [red CI #38481535952](https://github.com/Zennay/Supa/actions/runs/38481535952), exact original QA head `4a2c91352dc99a6d0319fba4ac6e3a76c8e2efdd`: **731 total / 726 PASS / exactly five intentional RED / 0 skips**, no incidental failures. Expected corrected source acceptance: all eight original assertions GREEN (three canonical M1 inspector positives; five invalid hasNextData/parseError/JSON script descriptor rejections), preserving generic errors, no source mutation and `m5Eligible=false`, `productionReady=false`, `rightsVerified=false`, `selectorVerified=false`.

Require actual exact QA HEAD hosted CI including npm ci, high audit, all tests, M1 matching and retailer permission gate, TS/Vite build, and applicable permanent VPS separately; no PASS stated until confirmed. No latest-main merge, zCloud independent write preflight/lease, source+QA owner review or explicit human release authorization implied.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
