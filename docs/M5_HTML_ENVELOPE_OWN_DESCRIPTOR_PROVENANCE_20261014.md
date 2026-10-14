# Pure future-M5 inspection envelope snapshot — own-data provenance

Issue [#2309](https://github.com/Zennay/Supa/issues/2309), independent product-core child of frozen exact-GREEN [#2306](https://github.com/Zennay/Supa/pull/2306) SHA `acdb51dd5b1ab146d0ccd3855a153acd4e3cbd81`.

## Contract

Canonical M1 `inspectHtml()` emits own ordinary data properties for `hasNextData`, `jsonLd` and `applicationJsonScripts`; each application/json descriptor has own `id` and `bytes`, and array entries are data properties. The exported pure M5 comparer previously dereferenced these fields before validation and again when hashing; a synthetic accessor could execute, reveal a private label in its exception, or change its claimed value between checks.

The offline M5 comparer now requires an own data property `source.html`, and takes one bounded in-memory snapshot of `hasNextData`, JSON-LD (existing own-data type/keys/parseError and numeric slot policy), and `applicationJsonScripts` own array records + own `id` and `bytes`. Every downstream candidate and fingerprint uses the same sanitized snapshot. Accessors/inherited properties/sparse arrays fail using `Invalid or unbounded inspected HTML shape`; no source labels in error. Existing 128 JSON-LD + 128 application-json scripts and 8 MiB per-script/aggregate JSON-size limits remain unchanged.

New entirely invented local regression suite covers source/html/envelope/descriptor accessors, numeric entry getters, inherited properties, sparse array, exact 8MiB and overbudget boundaries, real inline `inspectHtml` with nested JSON scripts + Product P3, empty abstain P2, failed-source P1, private source redaction, false selector/rights/production/M5 flags and immutability. The change covers only plain property getters and does not claim resistance to all JavaScript Proxy traps, cryptographic evidence beyond M1 SHA verification, retailer permissions or price observation validity.

## Release gate

**Supa M3 ACTIVE** — authentic same-demand PLUS 11 + DekaMarkt 11 ≤24h field evidence [#78](https://github.com/Zennay/Supa/issues/78) not yet supplied; M4/M5 INELIGIBLE. No new live scraping/HTTP, real people, retailer prices or production release. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite scope/task lease, source and independent QA review, exact hosted tests/current-main/trusted runner where applicable, genuine M3 evidence, source rights and explicit human releasego. Parent #2306, sibling product #2301 and QA branches unaffected.
