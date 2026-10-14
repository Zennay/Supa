# Future offline M5 — pinned source cohorts before comparison

Product issue [#2335](https://github.com/Zennay/Supa/issues/2335), child of frozen [product #2331](https://github.com/Zennay/Supa/pull/2331) SHA `2ae9fe6b6f9f88ec2130629856cdbe4f2e05802e`, already GitHub-hosted GREEN 1,190/1,190 Node tests, high npm audit 0, M1 source-permission/matching and TypeScript/Vite build.

## Pure exported in-memory inspection trust boundary

Canonical M1 `inspectCaptureDirectory()` returns own plain `sourceCount` and `sources` data properties. The exported `compareInspections(current, baseline)` formerly read `current.sources`, `current.sourceCount`, corresponding historical values and iterated sources directly. Even after source-level `captureShape` hardening, a fabricated cohort's accessor/getter or custom array iterator could run before source validation or change the source list after the count check.

The updated comparer separately pins **own data descriptors** for `sourceCount` and `sources` on current and, when present, historical cohorts. SourceCount must be a safe nonnegative integer exactly equal to the bounded sources-array length (MAX_SOURCES unchanged). Each declared numeric array element must be an own data descriptor, copied once into a locally allocated plain list. Source admission, duplicate detection, drift classification and review queue operate only on the copied cohort, so getters and custom iterator of the original array are not executed. Malformed current or historical envelopes/holes/accessors fail with their existing generic corresponding `Invalid or unbounded ... inspection` errors.

The new **20 synthetic Node cases** include own and inherited accessor roots, numeric-index getters, sparse slots, count coercion, custom Symbol.iterator nonexecution, actual synthetic Product/abstention and P1/P2/P3 outputs, privacy, nonmutating input, duplicate IDs, and always-false selector/rights/M5/production flags. No true retailer call, real prices, personal data, permission claim or production side effect. Not intended to protect against arbitrary JavaScript Proxy traps or external filesystem races; those require separate constraints and reviews.

## Release constraints

Supa remains **M3 ACTIVE**. Genuine same-demand [#78](https://github.com/Zennay/Supa/issues/78) 11 PLUS + 11 DekaMarkt human observations in a single ≤24-hour price context remain missing, so M4/M5 are **INELIGIBLE**. This future-M5 pure checker stays **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently verified zCloud SQLite task/scope lease, original source and QA review, full exact-head hosted CI/current-main/trusted runner where needed, verified retailer source rights, actual matched M3 field data and explicit human releasego.
