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

## Intake validator

Save one observed study as JSON using the `WeeklyBasketStudy` contract, then run:

```bash
npm run m3:validate-observed-study -- path/to/study.json
```

The command emits a compact JSON assessment with the study ID, claimability, outcome, totals, delta/savings, observation window and reasons.

Exit codes are deliberate:

- `0`: the observed study passes all evidence and basket gates;
- `2`: the document is readable but the study is not claimable; savings/delta stay suppressed where required;
- `1`: the input cannot be parsed or evaluated as a study document.

The CLI does not fetch supermarket data and does not turn regression fixtures into evidence. Its job is to make a manually observed, receipt-derived or consented study reproducible through the same fail-closed contract used in tests.

## Privacy and source boundary

Use pseudonymous participant keys and do not put names, email addresses or account IDs in versioned study fixtures.

The contract does not authorize automated supermarket collection. Production PLUS/DekaMarkt reuse remains permission-gated. Manual/receipt/consented evidence can be collected under the relevant study consent and provenance process.

## Current status

The validator and its tests are infrastructure for the M3 study. Synthetic regression fixtures are **not** themselves observed savings evidence. AUD-003 stays open until reproducible real-basket records exist with population, time window, positive/negative/unknown outcomes and uncertainty preserved.
