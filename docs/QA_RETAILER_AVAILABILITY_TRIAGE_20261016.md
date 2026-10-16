# Historical retailer availability — independent QA (M3)

This QA check is an **offline review of historical captured facts**, not live stock, a
shopping recommendation, a source license or evidence that SUPA saves money.

## Run

```sh
node --experimental-strip-types scripts/qa-retailer-availability-triage.mjs
node --experimental-strip-types scripts/qa-retailer-availability-triage.mjs --at 2026-10-16T00:00:00.000Z
node --experimental-strip-types --test tests/qa-retailer-availability-triage-20261016.test.mjs
```

The command reads **only** the six existing historical, reviewed repository
snapshots: PLUS and DekaMarkt × product, catalog, offers. It does not accept
retailer URLs or private file paths, make network requests, crawl websites,
write files or change production data. Passing a future audit clock, publication
flag, unknown argument or malformed evidence is rejected.

## Interpret the counters

- `available`: available **at the original source observation**. This does
  **not** mean the product can be purchased today.
- `unavailable`: unavailable **in that captured evidence**, never a purchasable
  line to silently include in a full-basket claim.
- `unknown`: the original observation did not prove stock. Do not convert this
  to available, unavailable or a fictitious price.
- `historicalObservations`: always exactly the sum of those three states, both
  overall and for each of the six retailer/source-kind rows.
- `needsHumanAvailabilityReview`: true if at least one unavailable/unknown
  historical observation exists. Even when false, no current availability is
  proven; `currentStockVerified` remains false and `releaseDecision` is hold.

The reviewer first calls the existing canonical adapter-health validation for
source identity, provenance, counters, observation shape and clock. Each QA
stock counter is cross-checked with its canonical unknown-availability counter;
rejected or missing source shapes cannot be silently treated as zero stock
problems. Only aggregate counts leave the process: **no product names, SKUs,
prices, source URLs or SHA digests**.

The independent source currently tracks `unknownAvailability` internally.
The product-core [integrated M3 preflight PR #3107](https://github.com/Zennay/Supa/pull/3107)
exposes unknown price counts but not the comparable historical availability
breakdown. This QA command fills the inspection gap without touching that
actively owned product-core code. Any product-surface integration must retain
separate release and ownership review.

## Limits and separate release gates

All outputs explicitly retain `historicalOnly:true`,
`permissionVerified:false`, `productionEnabled:false`,
`publicSavingsClaimEligible:false`, `liveRequests:0` and
`releaseDecision:"hold"`. This review does not verify current prices,
product availability at checkout, packaging equivalence or total savings.

SUPA remains in **M3** until written PLUS/Deka source reuse rights
[#74](https://github.com/Zennay/Supa/issues/74), a genuine paired 11 PLUS +
11 DekaMarkt same-context human basket observation within 24 hours
[#78](https://github.com/Zennay/Supa/issues/78), actual field revision SHA
[#205](https://github.com/Zennay/Supa/issues/205), and the applicable
permanent trusted VPS gate [#2833](https://github.com/Zennay/Supa/issues/2833)
are addressed independently. Hosted generic CI does not substitute for those.
