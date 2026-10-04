# M3 observed weekly-basket study contract

The full-basket comparator is calculation logic. It becomes savings evidence only when the inputs are actual observed baskets with enough provenance to reproduce the comparison.

## Required study context

Each weekly comparison records:

- a path-safe study ID;
- a pseudonymous participant key (no name, email or other direct identifier);
- target population and region;
- week start;
- baseline and candidate basket observations.

Each basket observation must include:

- its own evidence ID;
- an observation timestamp;
- an allowed observed source: `manual-cart`, `receipt` or `consented-export`;
- a provenance note explaining what was observed;
- a complete traced basket accepted by the existing fail-closed full-basket comparator.

## Time-window rule

Baseline and candidate observations default to a maximum 24-hour separation. If they are farther apart, the study returns `unknown` and exposes no savings number. This prevents normal price drift across different days from silently becoming a store-comparison claim.

## Claim boundary

A study is claimable only when both the evidence/provenance gate and the full-basket comparison gate pass.

The study must retain:

- better outcomes;
- same-price outcomes;
- worse outcomes;
- unknown/incomplete outcomes.

A negative or unknown result is evidence, not a record to discard.

## Privacy and source boundary

Use pseudonymous participant keys and do not put names, email addresses or account IDs in versioned study fixtures.

The contract does not authorize automated supermarket collection. Production PLUS/DekaMarkt reuse remains permission-gated. Manual/receipt/consented evidence can be collected under the relevant study consent and provenance process.

## Current status

The validator and its tests are infrastructure for the M3 study. Synthetic regression fixtures are **not** themselves observed savings evidence. AUD-003 stays open until reproducible real-basket records exist with population, time window, positive/negative/unknown outcomes and uncertainty preserved.

## Manual observation sheet

Generate the exact aggregated demand for the current proven four-meal planner fixture before visiting or manually checking two stores:

```bash
npm run m3:create-observation-sheet -- --output artifacts/m3/observation-sheet.json
```

The sheet contains the same 11 ingredient requirements for baseline and candidate, plus blank fields for store, timestamp, product, pack, price, availability and provenance. It is deliberately marked `collection-template-not-evidence`: do not prefill or infer supermarket values, and do not treat the generated sheet as savings evidence.

Use the sheet to record one genuine `manual-cart`, `receipt` or `consented-export` observation per store within the 24-hour study window. After the observations have been verified and converted into the `WeeklyBasketStudy` contract, run the operational assessment command below.

## Operational assessment command

Once a real observed study JSON has been collected under this contract, assess it reproducibly with:

```bash
npm run m3:assess-observed-week -- evidence/m3/<study>.json --output artifacts/m3/<study>-assessment.json
```

Before comparison/report generation, the CLI now performs a structural evidence preflight. It fails closed with a path-specific error when required study/evidence/basket fields are missing, observed-source values are invalid, money/counters are malformed, or a matched line's total does not reconcile to `packs × pricePerPackCents`. An invalid input does not emit an assessment file.

This preflight is intentionally not a substitute for provenance review: it proves the collected JSON is structurally trustworthy enough to enter the existing M3 evidence gate, not that a receipt/cart observation is genuine.

The report intentionally omits the pseudonymous participant key and includes only study/store provenance, totals, outcome, uncertainty and the evidence boundary. A `worse` or `unknown` study still produces a valid report; only malformed input is an execution error.

Do not commit receipt images, names, emails, account IDs or other direct identifiers. The CLI does not turn a single observed week into a public savings claim: every generated report keeps `publicSavingsClaimEligible: false`.

## Savings-effect attribution in the report

Observed study JSON may include an optional `attributionEvidence` array. Each item must reference a comparison line, use one of `pack-size`, `offer` or `planning`, provide an integer-cent delta and retain a non-empty evidence reference.

The assessment never infers a cause from price movement alone. Missing attribution evidence stays in `unknownCents`; malformed attribution items make attribution status `unknown` without fabricating a causal explanation. Planning attribution remains zero inside a same-demand store comparison.

The privacy-safe report emits only aggregate effect totals plus attribution status/reasons. Evidence references are validation inputs and are deliberately not copied into the report.
