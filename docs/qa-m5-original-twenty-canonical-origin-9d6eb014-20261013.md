# QA immutable replay — canonical M5 origin validation on newest owner #2149

**Supa M3 ACTIVE** (13 October 2026). Genuine human same-demand PLUS + DekaMarkt 11+11 [#78](https://github.com/Zennay/Supa/issues/78) still OPEN, M4/M5 expansion/production **ineligible**. Synthetic local-only QA, no network, real retailer data, rights approvals or public financial claims.

Newest separate product-source child [DRAFT #2149](https://github.com/Zennay/Supa/pull/2149), immutable source exact `9d6eb014fc10f6ff133c37a59f61533e9670d21c`, newly enforces bounded canonical supermarket/kind origin on both unavailable and verified captures. New frozen QA base `qa/frozen-m5-canonical-origin-9d6eb014-20261013`; own QA branch `qa/m5-original-twenty-canonical-origin-9d6eb014-20261013`. Only new add-only QA test/docs, no source, owner original tests, other worker branches, main or workflows touched.

Three **byte-identical** original QA test sources, intentionally preserving *all 20 assertions*, including prior 12 original RED and eight positive controls:
- original seven first/new failed capture P1 / drift tests [QA #2145](https://github.com/Zennay/Supa/pull/2145), Git blob `fa97541dfe7aad8d7cd065add4e6502fb28141c0`, now `tests/qa-m5-first-p1-canonical-origin-9d6eb014.test.mjs`;
- original six supermarket/kind origin drift P1 [QA #2135](https://github.com/Zennay/Supa/pull/2135), blob `070def9b787de88ae3c59abb38fda89fb27be895`, now `tests/qa-m5-source-origin-canonical-9d6eb014.test.mjs`;
- original seven malformed UTF-16 source IDs and forged verified/unavailable metadata [QA #2129](https://github.com/Zennay/Supa/pull/2129), blob `b876440b57d7b462aa6d4a3e21d5936d98084f11`, now `tests/qa-m5-source-metadata-canonical-9d6eb014.test.mjs`.

Purpose: verify that the latest **additional new canonical supermarket/kind origin validation** does not regress the previous three corrected trust contracts on this exact latest product head; earlier [independent QA #2148](https://github.com/Zennay/Supa/pull/2148) 734/734 green was against **older product #2146 SHA `9a9b800...`**, and cannot substitute for latest source evidence.

Expected exact QA-head hosted npm ci/high audit, full Node suites (no skipped), M1 benchmark/retailer permission gate and TS/Vite build. Later permanent VPS/Firefox, zCloud independent write preflight/lease, original owner review, latest-main integrated behavior, genuine human M3 field and explicit human release remain **not established** by hosted testing.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
