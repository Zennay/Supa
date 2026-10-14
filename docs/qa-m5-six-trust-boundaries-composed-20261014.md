# Supa quality-validation — six independent M5 trust suites on one corrected owner

**Immutable product source:** [product DRAFT #2319](https://github.com/Zennay/Supa/pull/2319), exact `433a5bf5ed53937a67aa6c90bd5eada4c6364add`. Only this own QA branch was written, not product code, original QA PRs, main, M1/M3/UI, workflow, VPS or any real retailer/user data.

**Why this combined replay:** individual corrected-owner CI passes do not prove their independently authored acceptance contracts coexist on the newest composite product source. This branch adds **six existing test suites, all 90 original independent synthetic scenarios, byte-identically from six frozen previously reviewed QA heads**, without changing a single original assertion:

| QA owner | Frozen test Git blob | Independent checks |
| --- | --- | ---: |
| [#2305](https://github.com/Zennay/Supa/pull/2305) direct queue JSON-LD candidate | `9f0a9b2ff1fd3f66d509f364248778af4bc5b165` | 13 |
| [#2299](https://github.com/Zennay/Supa/pull/2299) real Product-capable JSON-LD | `fad84ff3f742691a2a12220841e2135f8576bcb4` | 18 |
| [#2312](https://github.com/Zennay/Supa/pull/2312) JSON-LD own data descriptors | `85305b93dd878154b7514c6abe6280be0b5f3d22` | 14 |
| [#2315](https://github.com/Zennay/Supa/pull/2315) HTML/app-json own envelope | `f3ffb47d7d3365b97b19dcebe0d76f69b77b503f` | 15 |
| [#2317](https://github.com/Zennay/Supa/pull/2317) primitive SHA digests, no object coercion | `f8e1bb24e6c0a449976ccc28824a10d6b31cebfa` | 14 |
| [#2322](https://github.com/Zennay/Supa/pull/2322) own SHA descriptors, no getter/inheritance | `6c64428e68185c79494dab62bec2cd3c3e3d204c` | 16 |

All six files reside in `tests/` with their original names; each must retain its exact Git blob SHA on this QA branch. Their import sources, test assertions and reference fixtures are not modified. All data is fictional and in-memory; no real URLs are visited. Valid P1/P2/P3 cases must work, rejected forged/accessor metadata must never become manual trust evidence, no private price/identity leakage, source tokens opaque, all release/rights/selector/production gates false.

**Required release-neutral validation:** GitHub-hosted **exact-head full Node tests**, high npm audit, M1 matching/source-permission gate and TypeScript/Vite production build must all pass together. In case of a regression, investigate the exact suite and coordinate a separate source-owner fix; do not weaken immutable QA or silently change production. This is not a merge/release approval.

Supa **M3 ACTIVE**, real human same-demand [#78](https://github.com/Zennay/Supa/issues/78) 11 PLUS +11 DekaMarkt within 24h and actual source-rights evidence missing; M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until verified independent zCloud SQLite task/lease, original source+QA review, current-main/trusted runner if applicable, genuine field evidence and explicit human releasego.
