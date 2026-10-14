# Pure offline M5 capture: own source-origin and integrity envelope

Own product-core [issue #2329](https://github.com/Zennay/Supa/issues/2329) and frozen parent [#2327](https://github.com/Zennay/Supa/pull/2327) exact hosted-green SHA `fb27e9bff4e372579bdab05ff7978a51d51bd50d` (1,172/1,172 Node tests + audit/M1/build).

## Necessary M1 source contract

Canonical M1 supplies own, plain data fields for each capture's source `id`, `supermarket`, `kind`, Boolean `success`, and, after successful SHA-verification, literal `integrity:verified`, lowercase 64-character `manifestSha256`, `html`, and `schemaOrgProduct`. The exported pure `captureShape(source)` formerly dereferenced the ID, success, origin and integrity fields multiple times. An invented in-memory getter could run private code, return inconsistent source identities or execute arbitrary ToString on a digest RegExp test.

The corrected path snapshots required own data descriptors for id, origin, success before validation. On successful captures, own data descriptors for integrity, manifest digest, HTML and parser result are independently required. The SHA must be primitive hex **before** RegExp. Returned ID, supermarket, kind and manifest digest use the same sanitized snapshot, not later source dereferencing. Unavailable capture still has no HTML or Schema.org positive parser result. No real network or field evidence was collected.

Own 18 synthetic tests include inherited/throwing getter and nonprimitive coerced digest rejection without getter invocation, missing fields, malformed success, legitimate offline failure P1, abstain P2, Product P3, privacy, unmodified source and all false release/rights/M5 flags. This protection does not promise arbitrary Proxy trap immunity or authentic retailer rights, and deliberately does not change M1 adapters, external scrapers, M3 UI or the independent QA worker's branches.

**Supa M3 ACTIVE** — [#78](https://github.com/Zennay/Supa/issues/78) requires real human same-demand PLUS11 and DekaMarkt11 observations within the same 24-hour price context. M4/M5 INELIGIBLE; no savings/permission/beta claims. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently checked zCloud SQLite scope/task lease, original source+QA reviews, hosted exact-head/latest-main/trusted-runner as applicable, human observations, retailer rights and explicit release approval.
