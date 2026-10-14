# M5 offline raw capture origin: cohort-level pre-read contract

**Issue:** [#2201](https://github.com/Zennay/Supa/issues/2201)
**Frozen parent source:** [product #2200](https://github.com/Zennay/Supa/pull/2200)
`1ce6bec0385f730554b4e9ee3e1177a524677fca`.

The offline M5 capture reviewer already compared canonical inspected
source origin but did so **after** the M1 inspector could read earlier
successful HTML source files. The new raw manifest preflight rejects a
cohort whose `supermarket` or `kind` fields are non-string, empty,
longer than 128 characters or outside
`^[A-Za-z0-9][A-Za-z0-9._-]*$` on **any row**, including P1
unavailable records, **before either current or historical HTML
can be inspected**. This matches existing downstream
`requireCanonicalOrigin` semantics; no retailer or M1 source
format is expanded. The previous raw unique-ID, success-Boolean and
manifest byte/record bounds remain.

Eight synthetic product-owned regression scenarios cover ordinary
P2, unavailable P1, independent older P3, later missing store,
malformed kind, unavailable record with control-only store, overlong
kind, and invalid historical source with deliberately absent current
HTML. On refusal private CLI stdout is empty and only generic
stderr is emitted. These are local invented SHA-verified inputs,
not real retail or financial observations.

This work preserves source SHA integrity, provenance and chronology
limits, physical-root identity, HTML byte budget (8 MiB per file/tree),
manual review-only outcomes, and rights/selector/production/M5=false.
It does not change the M1 inspector, independent QA tests, workflows,
main, permanent VPS or human M3 evidence. A descriptor-pinned
manifest preflight is not a fully atomic HTML filesystem snapshot.

**M3 ACTIVE:** genuine human same-demand 11-line PLUS baseline
and 11-line DekaMarkt candidate within 24h
[issue #78](https://github.com/Zennay/Supa/issues/78) OPEN.
M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending
independent zCloud SQLite scope/task-write lease/claim, original
product and QA owners, latest-main safe reconciliation,
applicable permanent trusted runner verification, genuine field
evidence, and explicit human release authorization.
