# Future M5 offline direct-comparator CLI: private failures (14 October 2026)

Product-core 1/2. Issue [#2234](https://github.com/Zennay/Supa/issues/2234), isolated child of independently hosted+QA-green frozen product #2231 SHA `12b12a7a077a620456b03d0fd0de80f380d06bef`. No original M1 inspector, other product owners, independent QA branches, M3 collector, main/workflows or VPS changed.

## Finding
The M5 anonymous selector-review queue CLI already catches source-reading errors and emits only a generic private error, but the directly callable `scripts/m5-compare-capture-signatures.mjs` executable still ended with `await main()` without catch. Node.js prints a stack trace (sometimes including original absolute source paths/manifest filenames) when it hits an unreadable missing capture directory, unavailable manifest or filesystem error. Even though a direct valid comparison report is meant for local human review and can contain capture IDs, a failing operation must not print filesystem provenance to shared terminals, automation logs or CI.

## Product correction
The module's direct CLI entrypoint now catches errors from `main()`, writes exactly `Offline comparison failed: invalid capture or report` plus LF to stderr, sets nonzero process exit and emits **no stdout**. Exports `main()` and `compareCaptureDirectories()` are unaffected and still throw appropriate internal errors for trusted callers, preserving the old public pure API's diagnostic contract. Valid CLI reports and human-only non-production gates do not change. This does NOT make successful local JSON reports anonymous: raw source IDs in the manual comparison report remain intended for the operator and must not be published.

## Owned synthetic tests
`tests/product-m5-compare-cli-private-errors-20261014.test.mjs` runs 10 offline product regression cases with strictly fictional local paths and source labels: invalid/missing current root and manifest, malformed current/historical JSON, SHA-mismatched HTML (direct trusted JS API continues to report integrity mismatch), missing successful HTML, argument errors; original JSON unchanged and no private path/ID, stack or partial stdout for any failure. Positive controls preserve P1 unavailable without HTML, P2 current-only, and genuinely separate historical P3, all with productionReady=false and m5Eligible=false. No live retailer HTTP, customer data or actual store pricing.

## Explicit release HOLD
Supa is **M3 ACTIVE**: genuine 11 same-demand PLUS + 11 DekaMarkt observations within 24 hours GitHub #78 still OPEN. M4/M5 not eligible; this is only future offline local diagnostics privacy, not an approval to collect/scrape real store data or to claim savings.
**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud SQLite task-write scope/claim lease, original product and QA owner review, exact hosted CI and independent QA/current-main/trusted runner replay where relevant, genuine M3 human field observation and explicit human releasego.