# Future M5 manual review — SHA digest own data provenance

Product issue [#2318](https://github.com/Zennay/Supa/issues/2318), separate child of hosted-green [product #2316](https://github.com/Zennay/Supa/pull/2316), exact source `d20bfe455752957ec92711d40c970870c4bfd96c` (**1,123/1,123** green Node tests; audit high 0; M1 matching/source-permission; TS/Vite production build).

## Necessary input contract

A genuine `captureShape()` verified fingerprint has **own primitive strings** `snapshotSha256` and `shapeSha256`. Earlier child #2316 fixed RegExp#test coercion of string wrappers and objects, but still used `typeof snapshot.snapshotSha256`, which evaluates a caller-defined getter (possibly throwing sensitive text) on the exported direct `buildOfflineSelectorReviewQueue(report)` API. Likewise inherited getters can run.

Now use `Object.getOwnPropertyDescriptor` for both SHA properties in each verified current or historical source. Refuse absent, inherited and accessor descriptors **before** calling typeof or the lowercase 64-hex regex; only read their `value` descriptors. Failed captures have canonical null hashes and are unaffected. Does not claim Proxy-trap immunity or wider immutable-report guarantees. Reject using the existing fixed generic message; never log URLs, labels or user data.

Own fictional tests verify throwing/getter and inherited scenarios without any invocation, getter returning a legitimate-looking hash cannot pass, missing fields and P1/P2/P3 paths, failed captures remain human P1, canonical Product M1→comparison→manual P3 and all selector/rights/production/M5 flags false. Test inputs remain local; no retailer network or actual prices.

The original QA evidence [#2308](https://github.com/Zennay/Supa/pull/2308) is owned exclusively by QA 2/2; product-core never changes it. This is an *additional* boundary; follow-up QA fixed-source review remains independent.

**Supa M3 ACTIVE**, genuine human PLUS11+DekaMarkt11 identical demand within 24h [#78](https://github.com/Zennay/Supa/issues/78) still outstanding. M4/M5 INELIGIBLE. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until verified zCloud SQLite task/scope lease, original product/QA approvals, exact GitHub-hosted CI and latest-main/trusted runner checks as applicable, actual M3 field observations, retailer source-rights evidence and explicit human release authorization.
