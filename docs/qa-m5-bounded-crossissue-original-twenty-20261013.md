# Independent M5 bounded-shape no-regression matrix (13 Oct 2026)

**Milestone M3 ACTIVE.** Real human [#78](https://github.com/Zennay/Supa/issues/78) same-demand 11 PLUS + 11 DekaMarkt pair within 24 hours in a shared price context remains OPEN, and M4/M5 are not eligible. These cases are synthetic local snapshots, no live retailer activity, permission approval, participants or savings.

### Frozen ownership and QA provenance

Source: new 128/256-bound JSON-LD product [DRAFT #2151](https://github.com/Zennay/Supa/pull/2151), exact SHA `df45c8dcb7c9a4430f889907f642ed90c82cab88`. Independent source pin `qa/frozen-m5-bounded-crossissue-df45c8dc-20261013`; separate QA-only branch `qa/m5-bounded-crossissue-original-twenty-20261013`. No product/owner scripts, original QA, main, workflows, other workers or VPS files modified. Adds three NEW tests + provenance doc only.

**20 original unchanged cases reproduced byte-for-byte** to guard regressions caused by new shape bounds:
- 7 P1 missing/new failed capture cases from original [QA #2145](https://github.com/Zennay/Supa/pull/2145), Git blob `fa97541dfe7aad8d7cd065add4e6502fb28141c0`, now `tests/qa-m5-first-unavailable-bounded-df45c8dc.test.mjs`;
- 6 P1 changed store or source kind cases from original [QA #2135](https://github.com/Zennay/Supa/pull/2135), Git blob `070def9b787de88ae3c59abb38fda89fb27be895`, now `tests/qa-m5-origin-bounded-df45c8dc.test.mjs`;
- 7 malformed Unicode ID and forged capture metadata cases from original [QA #2129](https://github.com/Zennay/Supa/pull/2129), Git blob `b876440b57d7b462aa6d4a3e21d5936d98084f11`, now `tests/qa-m5-metadata-bounded-df45c8dc.test.mjs`.

12 historical intentional RED must stay GREEN, eight canonical positives must stay GREEN. Separately [new QA issue #2152](https://github.com/Zennay/Supa/issues/2152) focuses on scalar inspector values on **same frozen original product**: its RED results are not to be conflated with this positive cross-contract suite.

Verify exact QA HEAD via hosted npm ci/high audit, complete Node test set, M1 benchmark/retailer permission gate and TypeScript/Vite build. Passing hosted CI on this QA head does not replace permanent VPS/Firefox, integrated latest-main QA, zCloud write coordination claim/lease, original product owner approval, human M3 field #78 or human releasego.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
