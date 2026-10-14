# SUPA offline M5 source provenance integrity — origin metadata

## Phase and ownership

SUPA is **M3 ACTIVE**. A real human same-demand 11-line PLUS + DekaMarkt observation within one price context and 24 hours, [#78](https://github.com/Zennay/Supa/issues/78), is still absent. This synthetic offline product reliability work does not provide M4/M5 authorization, real retailer data, source reuse rights or evidence of savings.

Isolated follow-on product child of previously green [DRAFT #2146](https://github.com/Zennay/Supa/pull/2146) at exact immutable `9a9b800af117db9255f25b0271860bae790eed4a`. Original product/QA worker branches, `main`, workflows and data are unchanged. Existing [#2134](https://github.com/Zennay/Supa/issues/2134) origin-change and [#2144](https://github.com/Zennay/Supa/issues/2144) failed-first-source P1 rules remain intact.

## Concrete defect

Before this child, the M5 signature comparer accepted captures with missing or malformed `supermarket` and `kind` metadata and could return `unchanged` (the low-priority P3 human review) when both snapshots omitted these fields. Hash verification alone cannot establish which retailer or capture category generated the snapshot.

## Product correction

- Before emitting a signature snapshot for **verified or unavailable captures**, require both source origin fields to be nonempty, bounded (max 128 UTF-16 units), ASCII-safe identifiers containing only letters/digits/dots/underscores/hyphens with an alphanumeric first character.
- This matches the M1 supermarket directory shape and accepts known categories `product`, `catalog`, `offers` as well as fictional `category` in independent regression tests.
- Malformed origin values (null/object, missing, control/directional markers, path separators, overlong fields, lone surrogates) raise only `Invalid inspected source origin`, never echo offending labels. When the capture itself lacks SHA verification, the original integrity-first failure remains in force.
- Existing source-origin-change P1, unavailable-first/new P1, source token privacy and release flags are not relaxed; no source IDs, retailer URLs or new capture data are printed in the offline queue.

## Evidence procedure

```sh
node --test tests/product-m5-origin-metadata-validation-20261013.test.mjs
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

The new deterministic suite tests unchanged legitimate source origin, missing/invalid fields in both capture statuses, origin-change P1, integrity-order preservation, input immutability, and **actual privacy-safe CLI exit** from a disposable fictional M1 manifest with missing kind. No HTTP requests, actual supermarket observations, prices, accounts, or human participants are accessed.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until original owners, independent zCloud scope/preflight/write lease, exact-head hosted CI and applicable permanent VPS, latest-main integration, and human release go. This is preparation, not M5 entitlement.
