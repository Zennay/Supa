# M3 programmatic data trust — independent QA reference (16 October 2026)

## Scope and evidence

The exported `assessPrivateM3RetailerIngestion(permissionGate, batch, options)`
also accepts *in-process* JavaScript values. The normal operator CLI reads
stored JSON and cannot receive accessors or proxies by construction.

The unchanged original-main QA reproduction in
[PR #3118](https://github.com/Zennay/Supa/pull/3118) produced **five
independent hosted RED acceptance cases** in
[CI #38831134079](https://github.com/Zennay/Supa/actions/runs/38831134079):
the positive historical baseline and existing options getter refusal passed,
while source batch, nested provenance and permission objects containing
getters or proxies were accepted instead of rejected. This does **not**
establish an unauthorized external request, data theft, live scraper behavior,
or misleading published savings.

## This reference implementation

`scripts/qa-m3-inert-reviewed-data-snapshot.mjs` makes a bounded,
descriptor-only snapshot of source and permission input *before* the existing
canonical retailer validation. It is an independent QA helper **not yet wired
into the production M3 entry point**. That integration belongs to the
product-core owner.

The snapshot rejects all proxies and accessor properties before reading their
values, rejects inherited exotic object prototypes, arrays with holes, extra
array properties, non-JSON primitives, nonfinite numbers, cycles, oversized
arrays/objects and excessive nesting. It copies valid plain data to immutable
snapshots; it never edits original evidence, fetches a retailer URL, reveals
product details, or authorizes source rights.

```sh
node --experimental-strip-types --test tests/qa-m3-inert-reviewed-data-snapshot-20261016.test.mjs
```

This guard does NOT replace canonical validation of product identity,
provenance, clock, availability, packaging, price, normal-price corroboration,
source rights or M3 observation/field-study evidence. It is a boundary
condition which must run *before* any downstream property access.

## Product-owner acceptance

Run the unchanged seven original RED tests from #3118 **GREEN** after adding
a safe inert-source intake to M3; retain all original positive functionality.
Also replay the nine QA helper tests on genuine historical PLUS and DekaMarkt
fixtures without modifying source bytes, and full exact-head `npm ci`,
`npm audit --audit-level=high`, `npm test`, M1 matching, M1
source-permission refusal, TypeScript/Vite build and applicable trusted VPS.

A green QA helper alone is NOT a fix for the exported production API.
Standalone work remains historical only. Rights #74, real paired 11+11
basket proof #78, exact field SHA #205, and permanent VPS runner #2833
remain independent M3 release gates.
