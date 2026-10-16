# M3 — offline physical retailer capture identity audit

A reviewed `source.id` is a mutable app label, not proof that an HTML/SSR
capture happened twice. This **additive** operator audit checks the immutable
physical identity tuple *(retailer, kind, evidence type, exact source URL,
capture instant at nanosecond precision, SHA-256)* before claiming distinct historical source counts. The audit rejects impossible Gregorian dates, future timestamps beyond 60 seconds, physically impossible timezone offsets (below UTC−12:00 or above UTC+14:00), unapproved retailer domains and source URL query/fragment/credential suffixes. Equivalent ISO-8601 offset spellings of the same physical capture count as one identity.

## Run

```bash
node --experimental-strip-types scripts/retailer-private-capture-identity-audit.mjs
node --experimental-strip-types --test tests/product-private-capture-identity-audit-20261016.test.mjs
```

The command only loads the six fixed, sanitized archived M1 fixtures using the
existing symlink-safe, strict UTF-8/JSON local reader. It does **not** accept
URLs, external file paths, credentials, live network inputs or command flags.
Output is strictly aggregate-only (reviewed/unique source counts and
per-retailer counts); no product title, price, source URL, identifier, captured
time or SHA appears in logs. A repeated capture with a different mutable
`source.id` is rejected, not counted as independent corroboration.

The opt-in `ingestPhysicallyDistinctReviewedBatch(records)` entrypoint
runs this physical-identity guard **before** the existing private ingestion
engine: genuinely distinct archived PLUS/Deka records keep the engine's
private results, while aliased captures throw before producing a batch
summary. Existing callers of the old engine are unchanged; migration must
be reviewed and coordinated with its product owner.

The standalone `auditPhysicalRetailerCaptures` is also available to
already-authorized *private* in-memory review clients. It detaches caller input
using the same inert-JSON boundary used by the reviewed source adapters before
reading any fields, rejects malicious object shapes, and never mutates input.
It does not infer whether two *different* fingerprints represent genuinely
independent field observations, or authenticate the origin of a supplied hash.

## Important limitations / release gate

This is an **independent companion check**, not an integration into the
production ingest admission path. It does not fix the source engine's
`ingestReviewedBatch` double-count behavior by itself: product owner must
integrate the check under an exclusive verified zCloud source/task lease, then
replay the exact independent QA in [#3690](https://github.com/Zennay/Supa/pull/3690)
RED→GREEN. Do not modify that QA owner's test branch.

M3 remains private/offline-only: written retailer reuse consent #74, 11×2
same-context real human observations #78, field SHA pin #205, trusted runner
#2833, protected main merger authorization and relevant production rights are
**not** satisfied by this audit. `permissionVerified`,
`productionEnabled`, and `publicSavingsClaimEligible` are always false.
No external price publication, live scraping, rights escalation, savings
claim, or deploy is authorized.
