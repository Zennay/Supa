# Product-core handoff: actionable, evidence-honest basket comparison

Scope: new `src/features/basket/comparisonNextStep.ts` and isolated regression file. No overlapping basket comparator, Planner, retailer adapter, shopping persistence, or BasketView files were changed.

## User problem

An unknown/full-basket comparison currently says only that no financial difference can be shown. The consumer needs to know *what to do next*. Worse, current comparator issue [#1051](https://github.com/Zennay/Supa/issues/1051) can report two **empty** planned baskets as a claimable equal-price comparison. Presentation must not relay that false sense of validity.

## Independent functional adapter

`comparisonNextStep({ comparison, baseline, candidate })` returns:
- `choose-meals` when the active week / basket has no planned demand (including two zero-euro empty baskets);
- `complete-products` when at least one matched-ingredient decision is missing;
- `align-plans` for different meals/amounts/ingredient coverage;
- `choose-different-stores` for identical store IDs;
- `review-data` for malformed, inconsistent or non-claimable inputs;
- `comparison-ready` **only** for a complete, nonempty, internally consistent, canonical claimable two-store comparison.

Every state has a Dutch heading, explanation and next action. The only state with `canShowDifference: true` explicitly describes the two baskets as **controlled test data**, not live prices or proven customer savings. Raw technical comparator reasons (which may include ingredient identifiers) never become displayed text. This adapter never computes or changes financial values.

## Ownership-preserving integration

Current `BasketView.tsx` is owned by active BasketView PRs [#319](https://github.com/Zennay/Supa/pull/319) and [#118](https://github.com/Zennay/Supa/pull/118). **Do not edit it from this branch.** After owner coordination:

1. Import `comparisonNextStep` in BasketView and pass the existing `comparison`, `comparisonBaseline`, and `comparisonCandidate`.
2. Render `title`, `explanation` and `action` as normal readable text, with accessible status semantics and no fake clickable affordance. Keep the controlled data disclaimer visible in all cases.
3. Only show any comparison money-difference headline when **both** `comparison.claimable` and `guidance.canShowDifference` are true; never present 0/0 empty baskets as "even duur". Keep independent per-store basket minimum disclosures honest.
4. Avoid deriving or reconstructing savings from the guidance; the canonical comparator remains the financial authority. Do not display internal M2/M3 terminology, strings from `comparison.reasons`, or a live savings badge.
5. Run exact-head hosted build/tests, permanent VPS and real Firefox/mobile keyboard rendering gates on the settled BasketView head. Check empty week, incomplete ingredient, different demands/stores and better/same/worse controlled outcomes.
6. Fix upstream comparator issue #1051 *within its existing owner lane* [#1012](https://github.com/Zennay/Supa/pull/1012) so **all** downstream consumers, not just this UI, fail closed on an empty week. This presentation guard is defense in depth, **not** closure of #1051.

## Evidence boundary

Tests use only known, synthetic M2 product fixtures. No genuine PLUS/DekaMarkt price capture, user shopping observation, savings proof, retailer permission change, live scraper or M3 exit evidence. Real same-demand PLUS + DekaMarkt observation within 24 hours [#78](https://github.com/Zennay/Supa/issues/78) remains the M3 milestone gate.

## Validation

`npm test`, `npm run build`, and permanent VPS/browser gates must be interpreted only for **exact commit SHA**. Until BasketView integration and rendered proof are completed, this is an isolated **DRAFT/HOLD** feature, not a released customer-facing fix.
