# Controlled two-retailer source window — opt-in M3 preparation

**Scope:** Product issue [#168](https://github.com/Zennay/Supa/issues/168), stacked on the controlled one-store candidate [#1146](https://github.com/Zennay/Supa/pull/1146). This branch does not touch current adapters (#117/#122), ingestion, canonical basket/comparator, UI, source permissions, M3 collector/assessment, or `main`.

## What is new

`projectFreshControlledComparisonCatalogs({ baselineObservations, candidateObservations, baselineStore, candidateStore, referenceTime })` is a fail-closed product-core function for a **specified pair of different supermarkets**. It first projects both controlled observation batches through the existing exact identity/pack/count/price/offer/provenance gate, then checks every item against a caller-supplied, timezone-explicit reference time.

- Rejects missing, local or malformed capture times; requires an explicit UTC Z or numeric timezone offset on *all* timestamps.
- Rejects capture times after the declared reference instant, or older than **24 elapsed hours**, not calendar days.
- The earliest and latest product captures across **both** stores must be no more than 24 elapsed hours apart. **Exactly 24 hours passes.** Offset-equivalent timestamps represent the same instant.
- Fails the *whole* comparison if a store is missing, if both stores claim the same supermarket, if a catalog contains a duplicate or corrupt item, or if one row violates the window. No partial cheap basket is returned.
- Returns separate products with genuine source-bound pack counts and explicit `captureWindowHours`, not a savings assertion. It never uses `Date.now()`, so repeatability depends only on supplied inputs.
- Raw provenance and participant data are not copied into products. Input data are not modified.

## What this does NOT certify

Passing a structure/freshness gate does **not** establish that a store catalog covers all eleven actual meal demands, the product is purchasable, prices are licensed for reuse, a shop trip is geographically feasible, the source observation is authentically captured, or that a saving exists. The inputs used in regression tests are entirely **synthetic**. It is forbidden to treat this contract as meeting the genuine human-field proof in [issue #78](https://github.com/Zennay/Supa/issues/78). `captureWindowHours` is a property of the supplied **fixtures**, not a proof of M3 observation provenance.

## Four-meal, eleven-demand controlled integration

`tests/product-controlled-freshness-m2-basket-integration.test.mjs` connects the newly validated **two** source-shaped rice packs to the existing real four-meal M2 ingredient-demand plan and the actual one-store basket and full-basket comparator code. The DekaMarkt-shaped `6 × 500 g` pack satisfies the rice demand with **one** hypothetical 299-cent pack; the PLUS-shaped single 1 kg pack costs 249 hypothetical cents. All eleven demand lines are covered by **synthetic existing M2 catalog fixtures** plus the two projected rice products, so the comparator reports a 50-cent **worse** candidate. A timestamp one second older than 24 hours, or a future capture, blocks the entire comparison before pricing.

This is *integration of arithmetic and readiness behaviour only*. Nine/other products come from fixtures, not real PLUS/DekaMarkt captures. Comparator output cannot be treated as genuine savings. The real human field gate [#78](https://github.com/Zennay/Supa/issues/78) is unchanged.

## Separate release gates

1. The ingestion owner [#117](https://github.com/Zennay/Supa/pull/117) and retailer-adapter owner [#122](https://github.com/Zennay/Supa/pull/122) must preserve and verify source-derived pack count before any live path reuses this helper.
2. Retailer terms and explicit permission must allow the proposed data use; no new acquisition/scraping follows from this helper.
3. Compose and confirm both stores' **identical eleven ingredient demands**, complete match coverage, correct basket cost attribution, and verified real observations **within 24 hours** in the existing M3 owned field flow.
4. Obtain exact-head hosted CI and appropriate permanent M1/M3/VPS validation, original owner review, current-main rebase and safe integration.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
