# Future M5: primitive SHA-256 fields in direct review queues

## Reason and scope

Independent QA [issue #2307](https://github.com/Zennay/Supa/issues/2307) found that the separately exported offline `buildOfflineSelectorReviewQueue(report)` checked the 64-character SHA-256 fields using only `HEX_HASH.test(value)`. JavaScript RegExp#test converts input objects to strings. A fabricated `new String('a'.repeat(64))`, array, custom `toString` or `Symbol.toPrimitive` could either pass or execute unwanted caller code, even though the canonical M1 `captureShape` emits **primitive strings**.

This independent product-core child starts from frozen hosted-green composed [#2313](https://github.com/Zennay/Supa/pull/2313) commit `3727268c057abb40af5bf1ee1f04d1ce7b2f33c6`, integrating earlier schema, HTML envelope and direct queue provenance protections. In the direct-queue validator, verify `typeof snapshot.snapshotSha256 === 'string'` AND `typeof snapshot.shapeSha256 === 'string'` **before** regular-expression validation for every verified current or historical snapshot. Failed captures still use null hashes. No implicit coercion, user-defined method calls, or private error text.

Own fictional tests cover boxed strings, arrays, primitive-invalid values (null/undefined/boolean/number/bigint/symbol), custom/throwing toString and Symbol.toPrimitive with explicit not-called assertions, P1 historical/failed and P2/P3 current/baseline contexts, ordinary abstentions and actual local `captureShape`→`compareInspections`→human review. Preserve privacy-safe opaque source tokens and all `productionReady`, `rightsVerified`, `m5Eligible`, `selectorVerified` false.

Independent QA owns the original, unchanged [RED suite #2308](https://github.com/Zennay/Supa/pull/2308). Its author must separately replay *byte-identical* tests on frozen corrected product source, not have this product worker change QA tests or claim its results.

## Release hold

Supa **M3 ACTIVE**; genuine same-demand human [#78](https://github.com/Zennay/Supa/issues/78) PLUS11/DekaMarkt11 observations in one price context within 24h missing; M4/M5 INELIGIBLE. Synthetic M5 manual-only security checks do not establish source rights, live prices, or a savings claim. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud SQLite task/scope write lease and owner/QA approval, full exact-head hosted CI/latest-main/trusted runner as applicable, genuine paired field evidence, source rights and explicit human releasego.
