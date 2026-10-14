# M3 observation dates must correspond to the declared planning week

Owner-side product remediation for [#2093](https://github.com/Zennay/Supa/issues/2093). All tests use **entirely synthetic** full matched M2 baskets; genuine [M3 #78](https://github.com/Zennay/Supa/issues/78) remains OPEN.

## Date contract

`weekStart` denotes the start of a **seven-day** planned menu interval. Both competing store observations must occur during the seven-day interval **or on one of the two preceding calendar days** (for advance shopping). Shopping on the Monday following a Monday-start week must not count for the earlier week. This is deliberately an explicit policy choice, not a claim that real shoppers always shop on Mondays.

Each evidence `observedAt` timestamp declares its own UTC offset. Compare the **local civil calendar date in that timestamp** to the study's `YYYY-MM-DD` start date, rather than a rolling UTC-hour difference, to avoid incorrect rejection/acceptance around local midnight and daylight-saving transitions. Timestamps still require a valid explicit offset and the **independent max-24h cross-store window** (or stricter configured bound).

Out-of-window evidence is retained but the assessment fails closed with an explanatory reason: `claimable=false`, `outcome=unknown`, `deltaCents=null`, `savingsCents=null`. Source/basket information and private evidence remain unchanged. This is a technical comparison gate; it never changes `publicSavingsClaimEligible=false` on M3 private reports.

## Tests and boundaries

`node --experimental-strip-types --test tests/m3-product-week-observation-coherence.test.mjs` exercises positive fictional complete baskets, one-year past/future mislabels, first allowed pre-week Saturday, end-of-week Sunday, boundaries outside both ends, midnight with +02 offset, mismatch on candidate only, and real CLI private-output behavior.

Independent QA [#2094](https://github.com/Zennay/Supa/pull/2094) must replay its frozen controls on this corrected source. No network calls, real retailer data, beta users, real savings proof or permissions were generated. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud claim/lease/preflight, original domain owner and human approval, exact-head full CI and applicable permanent VPS, and latest-main integration.
