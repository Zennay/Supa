# M3 — opt-in civil UTC capture preflight (private only)

The pure reusable source validator lives at `src/data/retailerCivilCaptureClock.ts::isValidCivilCaptureAt`; the opt-in runtime preflight imports it directly, so an authorized adapter owner can use precisely the same clock boundary when integrating the six source parsers. No existing parser calls this module yet.\n\nThis isolated product-core entrypoint prevents the known **P1 #3701** UTC−13/−14 provenance issue from reaching the existing six-adapter `ingestReviewedBatch` **when the new entrypoint is used**. It does **not** change the currently unguarded adapters or their existing callers; it is **not a complete resolution of #3701** until the owner integrates the same fail-closed civil check at each authoritative source boundary.

## Reproducible invocation

```bash
node --experimental-strip-types scripts/retailer-private-civil-clock-preflight.mjs
node --experimental-strip-types --test tests/product-retailer-private-civil-clock-preflight-20261016.test.mjs
```

The CLI reads only the six pinned checked-in sanitized M1 records (3 PLUS and 3 DekaMarkt) via the existing bounded, no-symlink/duplicate-key file reader. It prints **aggregate counts only**, including `civilClockPreflight: true` and `physicalCaptureAliasGuard: true`; no raw source URLs, hashes or source IDs are printed. CLI arguments are admitted through the existing inert-JSON boundary so hostile Proxy/accessor objects are not inspected. No HTTP, browser, DNS, proxy, credentials, new product price, source authorization, field observation or public data output is performed.

For in-memory reviewed records, import:

```js
import { ingestCivilClockCheckedReviewedBatch } from './scripts/retailer-private-civil-clock-preflight.mjs'
const privateResults = ingestCivilClockCheckedReviewedBatch(prevalidatedArchivedRecords)
```

Each input is first detached through the existing inert-JSON boundary; all six retailer/kind shapes must possess strict valid Gregorian ISO timestamps and physically possible civil offsets **UTC−12:00 through UTC+14:00**, with at most 60 seconds future clock skew. The entire batch fails before parsing *any* observations if even one source clock is invalid. Before entering the ordinary ingestion engine, it also refuses duplicate physical source captures whose `source.id` has been renamed or whose otherwise identical clock is spelled with a legal equivalent timezone. The private key compares retailer + kind + exact archived URL + SHA-256 + UTC **nanosecond** instant; differently timed legitimate captures are not collapsed. This is an opt-in guard against the physical alias failure identified in [P1 #3692](https://github.com/Zennay/Supa/issues/3692) and legal-offset variant [P2 #3702](https://github.com/Zennay/Supa/issues/3702), not a fix to existing callers or the separately owned [physical audit #3694](https://github.com/Zennay/Supa/pull/3694). The wrapper also refuses the complete result when any underlying adapter rejects a source: unlike the ordinary engine's partial-review mode it never returns a mixed accepted/rejected batch. Genuine physically equivalent legal UTC−12:00 and UTC+14:00 spellings of historical timestamps remain valid, while UTC−12:01, −13:00, −14:00, +14:01 and absent timezones fail. The usual six adapters and source identity, rights and duplicate-ID restrictions still apply.

## Release/rights/ownership

This is an optional, **offline/private nonmerge product path**, not a modification to `scripts/retailer-reviewed-ingest-engine.mjs`, `src/data/*`, QA peer PRs, source permissions, UI, `main`, or VPS. It neither repairs nor claims to repair the unmodified public `ingestReviewedBatch` contract; product source owner of [#3687](https://github.com/Zennay/Supa/pull/3687) must integrate corrections for all six adapters and replay the original immutable independent [QA #3700](https://github.com/Zennay/Supa/pull/3700) from [P1 #3701](https://github.com/Zennay/Supa/issues/3701) unchanged.

The current canonical rights gate is `productionReady:false`: PLUS permission_required, Deka unresolved. M3 written source rights [#74](https://github.com/Zennay/Supa/issues/74), genuine 11×2 human comparison [#78](https://github.com/Zennay/Supa/issues/78), pinned observation code [#205](https://github.com/Zennay/Supa/issues/205) and approved permanent runner [#2833](https://github.com/Zennay/Supa/issues/2833) remain HOLD. No public savings claim, current prices, production ingestion, deployment or protected main merge is authorized by this tool. CI green (if it completes) proves only the frozen offline branch, not external retailer permissions or live VPS.
