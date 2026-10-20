# M3 private PLUS/Deka cross-store physical pairing — independent QA oracle

The reviewed historical six-source inputs already let Supa propose potential cross-retailer product matches based on **physical pack amount + normalized name tokens**. A syntactic name/pack match is *never* product equivalence, live price authority or a savings claim. This independent test campaign exercises those decisions on actual reviewed catalog envelopes.

## Run

```sh
node --experimental-strip-types --test tests/qa-m3-independent-physical-pair-metamorphic-oracle-20261017.test.mjs
```

Use project-supported Node 24. No external retailer HTTP, production scheduler, auth, data-permission changes, field observations or publication. All price amounts in this QA are explicit fictional in-memory controls; no fake pricing is stored in fixtures or reported as fresh shelf prices.

## Scenario matrix — 649 concrete data permutations

| Invariant | Cases | Expected |
| --- | ---: | --- |
| Real underlying retailer catalog + independent pack unit equivalence | 384 | Matched and mismatched kg/g, l/ml, source-row order, label-token order and amount controls. Exact physical equivalence permits **one human-review candidate only**. A one-base-unit near miss permits none. |
| Retailer prices independent of physical equivalence | 192 | Zero vs high fictional price cents, both store orientations, mass/volume, amount and names; same unverified candidate count and **no chosen price or savings** regardless of where the lower price appears. |
| Ambiguous cloned-product source identities | 48 | An otherwise identical second store product ID blocks a 1:1 candidate; records 1 ambiguous group, 3 ambiguous products. |
| Extra/changed product name tokens | 24 | Same physical pack does not imply a match for distinct words. |
| Conflicted immutable history | 1 | One retailer history with different private price facts is excluded from candidate selection. |
| **Total actual scenarios** | **649** | **Six top-level native test methods**, not 649 separately registered tests. |

In every successful scenario, `verifiedEquivalentProducts === 0`, `priceComparisonsAvailable === false`, `permissionVerified === false`, `productionEnabled === false`, `publicSavingsClaimEligible === false`, and `externalRequests === 0`. Every candidate carries `human-review-required`, `verifiedEquivalent:false`, `verifiedPriceMatch:false` and `priceComparisonCents:null`.

## Limitations and release boundaries

- This does not show that the synthetic labels represent actual equivalent products, nor does it measure real discounts, promotion stacking, allergies, dietary suitability, customer savings or store stock.
- The source still requires real documentary permissions [#74](https://github.com/Zennay/Supa/issues/74), independent matched human 11+11 field evidence [#78](https://github.com/Zennay/Supa/issues/78), a persisted field-run source code pin [#205](https://github.com/Zennay/Supa/issues/205) and a real permanent runner proof [#2833](https://github.com/Zennay/Supa/issues/2833).
- This file and its corresponding test file are new and QA-only. Do not modify the private cross-store source algorithm, retailer adapters, source rights, production settings, peer-owned paths or M3 CI YAML in this lane.
- Required acceptance before merge: exact-head full native Node test CI (with the original official logs), npm dependency high audit, historical M1 matching, actual source permission evaluator yielding `productionReady:false`, TypeScript/Vite build, up-to-date main and exclusive zCloud `supa:main-merge` claim.

The suite is intentionally repeatable and deterministic, not a simulated consumer store comparison.
