# M3 QA — all 255 real exported CLI choices, 18 real SQLite subprocess comparisons

**Frozen composite product source:** [#3005](https://github.com/Zennay/Supa/pull/3005), exact commit `33eed317e124347ae388c1ca8562e6613694095e` on current main `ac09ea8bb99d34321983e6639f6c7b2d962a3a38`. Work owner is quality-validation 2/2; only independent QA additions on a separate branch, no product engine or peer ownership edits.

Earlier [#3000](https://github.com/Zennay/Supa/pull/3000) and stacked [#3007](https://github.com/Zennay/Supa/pull/3007) already prove **255 direct domain planner choices** and **3 paired process-equivalent samples** on the existing offline historical six-source dataset. This additional suite targets the *operator-facing execution boundary*, not just the pure domain function:

- Run the real exported `retailer-reviewed-custom-week.mjs main()` for **all 255 distinct nonempty four-day/three-approved-recipe selections**, independently count physically required ingredient IDs from frozen recipe fixtures, and verify emitted stdout is one canonical private JSON record and all output contains no retailer source, SKU, timestamp, customer ID or money.
- Run **12 real Node CLI subprocess pairs** (each of 4 allowed days × each of 3 recipes) through both in-memory and temporary SQLite→Python pipelines, checking no warnings, safe row counts, per-store reviews and exact consistency.
- Run **6 additional two-day pairs** covering all unordered day pairs with two independently selected approved recipes across *both real subprocess paths*. Assert both paths agree on private, non-publishable count output and no source identifiers.
- Preserve the unmodified global M2 plan. No real retailer HTTP, real store/cart observations, customer data, scraping license, public prices or output artifacts are produced.

CI admission: exact-hosted Node tests, npm high audit, M1 matching, M1 source permission and TS/Vite build; record true results, do not claim GREEN before run finishes. This does not authorize production/merge: independent review + authoritative scoped zCloud SQLite lease + applicable trusted permanent VPS path gate [#2833](https://github.com/Zennay/Supa/issues/2833). External M3 field/source rights/codepin HOLD [#78](https://github.com/Zennay/Supa/issues/78), [#74](https://github.com/Zennay/Supa/issues/74), [#205](https://github.com/Zennay/Supa/issues/205).
