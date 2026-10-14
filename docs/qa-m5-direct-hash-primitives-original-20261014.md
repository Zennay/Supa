# QA #2307 — verified direct queue SHA must be a primitive string

Frozen original source: product-core [DRAFT #2301](https://github.com/Zennay/Supa/pull/2301) **`22f34b38801871a9af73f71af56024d08ec78096`**, which already fixed the unrelated #2295 candidate parse-count issue. That existing fix and [independent QA #2305](https://github.com/Zennay/Supa/pull/2305) remain untouched.

New direct API bug: `RegExp.test(value)` coerces non-string hash fields to text. Consequently an object with `toString()`, `Symbol.toPrimitive`, an array or boxed String may pass the hex/length regexp although `captureShape()` emits only primitive digest strings. Arbitrary coercion may run during otherwise pure review validation and exceptions may expose data. No real incident alleged.

The **14 independent fake in-memory tests** exercise five valid controls and nine intended original-source RED cases. Current/historical snapshot SHA and shape SHA are both covered, including no-baseline P2, stable P3, removed P1 and changed HTML P1. Negative controls demand `Invalid offline capture comparison report` without executing private coercion hooks; genuine Product/abstain/failed M1 remain valid manual priority review. Opaque tokens, privacy and rights/production/selector/M5 false gates asserted. No retailer/network/user/price data.

This QA branch adds only this test and documentation; **never merge expected RED**, do not weaken tests, do not modify product or other workers. Product-core alone owns separate fix; after fixed-owner source is frozen QA should replay **byte-identical** tests and require hosted all-green CI/high audit/M1/TS Vite build.

Supa **M3 ACTIVE**, authentic human [#78 11 PLUS+11 DekaMarkt same-demand basket within 24h](https://github.com/Zennay/Supa/issues/78) still missing. **DRAFT/HOLD/NO MERGE/NO DEPLOY** absent independent zCloud SQLite task-scope write lease, original product+QA reviews, latest-main/trusted runner as needed, actual field evidence/rights and explicit human releasego.
