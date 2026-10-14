# Supa quality-validation — nine immutable M5 trust boundaries on one final owner

**Frozen product source:** [DRAFT #2331](https://github.com/Zennay/Supa/pull/2331), latest corrected HEAD `2ae9fe6b6f9f88ec2130629856cdbe4f2e05802e`. Earlier source `71623b7285a2bda5db7e0da9141da8696fe76fbc` is superseded by the product owner's error-precedence repair; this QA composition uses the definitive latest frozen product version only.

**Purpose:** separate source fixes and their individual GitHub-hosted green runs cannot by themselves prove that every independent QA contract passes when the latest source is combined. This QA-only branch adds **nine original independent test suites (153 tests), all copied byte-identically from immutable previous QA green branches**. No old assertion, test fixture, product source or any other worker's branch was modified.

| Trust boundary | Immutable independent Git test blob | QA scenarios |
|---|---|---:|
| [#2295](https://github.com/Zennay/Supa/issues/2295) direct queue parsed JSON-LD candidate | `9f0a9b2ff1fd3f66d509f364248778af4bc5b165` | 13 |
| [#2293](https://github.com/Zennay/Supa/issues/2293) Product-capable JSON-LD provenance | `fad84ff3f742691a2a12220841e2135f8576bcb4` | 18 |
| [#2304](https://github.com/Zennay/Supa/issues/2304) own JSON-LD record metadata | `85305b93dd878154b7514c6abe6280be0b5f3d22` | 14 |
| [#2309](https://github.com/Zennay/Supa/issues/2309) own HTML/application-json metadata | `f3ffb47d7d3365b97b19dcebe0d76f69b77b503f` | 15 |
| [#2307](https://github.com/Zennay/Supa/issues/2307) primitive direct queue SHA values | `f8e1bb24e6c0a449976ccc28824a10d6b31cebfa` | 14 |
| [#2318](https://github.com/Zennay/Supa/issues/2318) own SHA descriptor provenance | `6c64428e68185c79494dab62bec2cd3c3e3d204c` | 16 |
| [#2321](https://github.com/Zennay/Supa/issues/2321) own change/current/historical snapshot fields | `d6ee78318b0b30e62adaed2542f8da547b745b93` | 23 |
| [#2325](https://github.com/Zennay/Supa/issues/2325) own review-root report envelope | `459f266cad8cbb99e8c1caf35cf4a888ef3fd550` | 18 |
| [#2329](https://github.com/Zennay/Supa/issues/2329) own capture-source ID/origin/integrity | `4925f480d2fb22e66b318079a2da38acbc0d7501` | 22 |
| **Total** | **Nine original SHA-verified QA test blobs** | **153** |

The nine files remain under `tests/` with original names. Confirm each HEAD blob before approval. Tests use exclusively invented local M1 `inspectHtml`/capture and pure M5 review, **zero live supermarket/user/price HTTP**. They demand valid manual P1/P2/P3 review, privacy-safe source tokens, reject falsified Product/SHA/HTML/JSON-LD/inherited/getter metadata, and preserve rights/selector/production/M5 readiness flags false.

**Verification:** require this independent **exact-head hosted full Node test suite**, high npm audit, M1 matching/source permission and TypeScript/Vite build GREEN. Do not extrapolate from earlier isolated QA or product tests. If regressions emerge, document the exact failed case and coordinate a separate product-owner fix; do not change original assertions.

Supa **M3 ACTIVE**. Human genuine [#78](https://github.com/Zennay/Supa/issues/78) same-demand 11 PLUS +11 DekaMarkt within a 24-hour price context and legal source permission not evidenced. M4/M5 **INELIGIBLE**. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently verified zCloud SQLite task/scope write lease, original source and QA reviewers, latest-main/trusted runner where relevant, authentic real field measurements/rights and explicit human releasego. No main, M1/M3/UI, workflows, permanent VPS or unrelated worker branch writes.
