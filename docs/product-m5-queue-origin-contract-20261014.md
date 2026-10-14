# SUPA product-core — private M5 queue source-origin contract (14 October 2026)

## Observed gap and scope
The future/offline pure selector-review queue accepted reports with source IDs longer than the canonical M5 comparer allows (129–512 UTF-16 code units), and lacked validation of each snapshot's `supermarket` and `kind` fields. Forged current and historical snapshots could therefore claim matching missing origins and receive apparently low-priority P3 `unchanged` review even though the upstream `captureShape()` cannot emit them.

Issue: https://github.com/Zennay/Supa/issues/2247

**Frozen source parent:** product DRAFT #2243 `2ad763d96c4f276a138efcece08b96a872026004`; separate product-core child. The original #2243 branch, original QA, M3 collector, M1 inspector, UI, `main`, workflows, permanent VPS and retailer evidence are untouched. The child inherits unmerged earlier M5 work; its PR is not merge-ready.

## Correction
- Enforce a 128 UTF-16-unit source ID length bound at the downstream pure queue. Existing downstream well-formed supplementary Unicode source tokens retain deterministic behaviour; this patch does not change earlier QA's Unicode policy.
- Validate every non-null current and historical snapshot's `supermarket` and `kind`: 1–128 ASCII letters/digits/dot/underscore/hyphen, first character alphanumeric, matching the upstream capture comparer's origin predicate. Validation is required even for `unavailable`, P1 removal and P3 unchanged.
- Refuse malformed input with the one generic, source-independent `Invalid offline capture comparison report` error. No private label, source ID, raw URL or price is placed in output/errors.
- Preserve 100 current plus 100 historical union, P1/P2/P3 human review semantics, input immutability, opaque SHA-256 source tokens, and all rights, selector, production and M5 release flags permanently `false`.

## Synthetic product validation
`node --test tests/product-m5-queue-origin-contract-20261014.test.mjs`

The independent new 10-test suite covers 128/129 source ID boundaries, stable Unicode tokens, malformed/missing current retailer metadata, malformed/missing historical kind metadata, matching missing P3, unavailable P1, legitimate origin drift P1, no-baseline P2 and valid 200-action union. No requests to retailers, no real prices, no human evidence and no change to other product branches.

For full release assessment require GitHub hosted exact-head `npm test`, M1 matching benchmark and source-permission gate, `npm audit --audit-level=high`, TypeScript/Vite build and original independent QA replay. CI success is not human retailer observation or authorization.

## Milestone / stop gates
**M3 ACTIVE.** Genuine PLUS baseline 11 + DekaMarkt candidate 11 same-demand lines within one 24-hour price context under [#78](https://github.com/Zennay/Supa/issues/78) remain absent; no M4 beta, M5 retailer rollout, production selector approval or public savings claim. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending verified independent zCloud SQLite conflict scope/write lease, source/QA owner review, latest-main integration, permanent runner where applicable, actual field evidence and explicit human release approval.
