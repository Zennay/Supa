# Future-M5 exported direct review: own data, snapshot-once provenance

**Scope:** Supa product-core 1/2, fully invented in-memory reports. Separate issue [#2321](https://github.com/Zennay/Supa/issues/2321), child of [product DRAFT #2319](https://github.com/Zennay/Supa/pull/2319) immutable hosted GREEN `433a5bf5ed53937a67aa6c90bd5eada4c6364add` (1,138/1,138 Node tests + audit/M1/build).

## Why

The direct pure `buildOfflineSelectorReviewQueue(report)` accepts prebuilt reports, not solely output from `compareInspections()`. It already validates SHA digest own primitive data, but other `change` and `snapshot` properties were directly dereferenced, potentially executing fake getters, leaking sensitive exceptions or observing different metadata between checks.

This child pins the declared changes-array slots, each change row's **own data** `id/status/current/baseline`, and per-side snapshot's **own data** `id/supermarket/kind/captureStatus/snapshotSha256/shapeSha256/schemaOrgStatus`; its optional M1 inspection fields `hasNextData/jsonLdCount/jsonLdParseErrors` are captured only when present as own properties. Validated local copies are used throughout P1/P2/P3, same-HTML hash consistency, origin drift, zero-success candidate proof and opaque source token generation. Every attempted accessor or missing mandatory field produces only the existing generic error; no private getter executes on those fields. Historical cohorts receive identical treatment, and failed captures retain null hashes and omitted inspection signals.

New **20** local, entirely fictional product tests exercise own/inherited/throwing getters, row current/baseline getters, array-slot accessors, stable no-baseline P2, unavailable P1 and paired P3, a real synthetic M1 `captureShape`→`compareInspections`→queue, privacy, immutability, original trust guards and all false source rights/selector/production/M5 flags. This is deliberately bounded: it does not claim arbitrary Proxy-trap immunity or safety from getters in report-level envelope metadata, nor source rights or real prices. Other independent QA/product branches and `main` are untouched.

## Release gate

Supa **M3 ACTIVE**: [#78](https://github.com/Zennay/Supa/issues/78) still needs authentic human matched 11 PLUS + 11 DekaMarkt same-demand observations in one 24-hour price context. M4/M5 INELIGIBLE. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently verified zCloud SQLite task/scope write lease, original product/QA review, hosted exact-head/full latest-main trusted runner as applicable, real M3 field and legal source rights and explicit human release approval.
