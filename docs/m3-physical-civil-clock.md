# M3 physical capture clock — private integration primitive

This module is a deliberately narrow, **offline-only** product-core primitive for source-admission owners. It does not fetch retailers, turn captures into trusted prices, change the canonical permission gate or grant release eligibility.

```js
import {
  physicalCaptureNanoseconds,
  samePhysicalCaptureInstant,
} from '../scripts/retailer-physical-civil-clock.mjs'

physicalCaptureNanoseconds('2026-10-04T18:08:57.837123456Z')
// bigint UTC nanoseconds

samePhysicalCaptureInstant(
  '2026-10-04T18:08:57.837123456Z',
  '2026-10-04T20:08:57.837123456+02:00',
) // true
```

## Contract

- Accepts **only primitive strings** with explicit ISO date, time, seconds and `Z` or signed `HH:MM` offset. It never invokes user-supplied coercion methods.
- Refuses invalid real Gregorian dates and times, positive offsets above **UTC+14:00**, and negative offsets below **UTC−12:00**, including `−12:01`, `−13:00`, `−14:00`. It also rejects RFC 3339 `-00:00` (unknown local offset), rather than treating uncertainty as a known physical clock.
- Converts valid civil timestamps to **exact BigInt UTC nanoseconds** (no `Date.parse` millisecond truncation). Physical aliases identify one instant while real one-nanosecond recaptures remain different.
- Returns `null` for malformed input. Consumers **must reject** a `null` source timestamp before counting a reviewed physical capture.
- This is only chronology notation validity. The caller **still must** enforce inert own-data objects, reviewed retailer origin, archived source SHA, no token-bearing URLs, impossible future captures, deduplication, permissions and field-evidence safeguards.

## Ownership and non-claims

This add-only opt-in helper intentionally does **not** change the source files owned by active product [#3706](https://github.com/Zennay/Supa/pull/3706), [#3687](https://github.com/Zennay/Supa/pull/3687), or independent QA branches [#3700](https://github.com/Zennay/Supa/pull/3700) / [#3710](https://github.com/Zennay/Supa/pull/3710). In particular, it does not claim to resolve authoritative adapter P1 [#3701](https://github.com/Zennay/Supa/issues/3701), direct universal catalog P1 [#3711](https://github.com/Zennay/Supa/issues/3711), or physical duplicate source counting P2 [#3702](https://github.com/Zennay/Supa/issues/3702) until their original source owners integrate and replay immutable independent QA RED→GREEN.

Test locally with `node --test tests/product-retailer-physical-civil-clock.test.mjs`. For merge, use exclusive authoritative zCloud scoped source/task and protected main merger leases, independent latest-main composition, exact native npm ci/audit high/Node/M1 matching/**actual denied source-permission gate**/TS+Vite build and applicable VPS checks. Keep **DRAFT / NONMERGE**, no live retailer HTTP, published savings or production activation. M3 written retailer rights #74, human 11×2 observation #78, source SHA #205 and trusted permanent runner #2833 remain outstanding.
