# QA: direct reviewed retailer catalog batch-summary integrity (15 Oct 2026)

## What this tests
The public JavaScript export `buildUniversalRetailerCatalog(batch)` is separate
from the stricter private Python SQLite importer and the normal
`ingestReviewedBatch` constructor. It currently recognizes
`batch.summary.mode === "reviewed-offline-only"`, then accepts the results.
The original six locally reviewed PLUS/DekaMarkt fixtures carry an explicit
private-only batch summary including permission, public savings eligibility,
source counts and observation counts.

A direct caller that replaces just one field of this trustworthy original
summary must be **refused**, not silently projected as a complete reviewed
catalog. The regression file adds an unchanged six-source positive control and
seven one-field negative controls:
- `productionEnabled:true`, `permissionVerified:true`,
  `publicSavingsClaimEligible:true`;
- `sources:99`, `acceptedSources:1`, `rejectedSources:1`,
  `observations:+1`.

Each negative preserves every individual observation, source fingerprint,
retailer identity, historical price and captured time. The discrepancy is at
the **summary trust boundary**, not inside a supermarket adapter.

## Replay

```bash
node --experimental-strip-types --test \
  tests/qa-retailer-direct-batch-summary-trust-20261015.test.mjs
```

Use the **exact immutable QA branch commit** to confirm actual failures in
GitHub-hosted CI. Do not infer the current run result from an older commit.
The expected answer from the original direct export is *seven failed negative
assertions*; these are acceptance demands, not claims of confirmed hosted
results until an exact-run log has been inspected.

## Owner-safe repair contract

The product-core owner may choose an explicit typed batch envelope or a
strict summary validation; in either case reject any present approval flag
that is not literally false and reject contradictions between declared and
physical counts before return. Preserve the existing accepted minimal
synthetic review-batch API cases, if still intentionally supported, by
documenting those lower-information calls distinctly rather than silently
treating a contradictory complete six-source summary as valid.

Keep the invariant `currentTrustedPriceCents:null`,
`publishable:false`, `productionEnabled:false` and
`publicSavingsClaimEligible:false` in every valid returned review.
Do not grant source rights, activate crawling, publish historic prices or
merge an intentionally red QA test into main. Replay the byte-identical
regression against the exact repaired source SHA, along with the full Node
suite, high audit, M1 matching/rights and build.

## Risk boundary
This is a **synthetic direct-API admission inconsistency**, not evidence that
the ordinary canonical six-fixture ingestion path grants production rights.
The current projector sets its *output* publication/production flags to
false; there is no demonstrated live price exposure or security exploit.
Separate M3 release gates remain real human 11+11 field evidence (#78),
written retailer data rights (#74), digest-bound provenance (#205), and the
trusted permanent VPS workflow (#2833).

The tests do not touch product-core code, CI/workflow files, external
retailer traffic, VPS state, or any other active worker's branch.
