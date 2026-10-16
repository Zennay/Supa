# M3 private historical SQLite audit: importer parity

## Why this exists

Canonical `scripts/retailer-import-universal-sqlite.py` checks incoming offline retailer facts before import. The separate `scripts/retailer-audit-private-sqlite.py` is also directly callable on an existing file. SQLite's storage classes, affinity and CHECK expressions can allow values the importer explicitly rejects. Valid foreign keys, table shapes and six accepted historical source kinds are **necessary but insufficient** for a trusted review.

The read-only auditor now independently checks, for **every** bounded stored product and observation:
- product ID: ASCII alphanumeric first, then up to 100 `A–Z/a–z/0–9/._-` characters; rejects spaces and invalid identities even if all foreign keys agree;
- display name: nonblank, at most 1,024 characters, canonical trimmed form; search name equals the same NFKC/case-fold/whitespace normalization used by the importer;
- price, offer price, original cents: either SQL NULL or a stored integer between 0 and `9007199254740991` inclusive, rejecting REAL fractions/decimal-affinity bypass;
- pack amount: SQL NULL or physical INTEGER/REAL finite number strictly `>0` and `<1000000000000`, rejecting text and nonfinite storage;
- optional pack source text at most 256 characters and optional offer label nonblank/trimmed/at most 1,024.

No catalogue facts, private source URL, SKU, amount or local database path are included in the output. A refusal remains **exit status 2**, empty stdout and the fixed generic privacy-safe stderr. The database remains untouched: `0600`, read-only URI/immutable mode and no journal/WAL files. A valid six-source archive still returns `releaseDecision:hold` with source rights and public price/savings **false**.

## Run locally on test-only data

```bash
node --test tests/product-m3-sqlite-direct-importer-fact-parity-20261016.test.mjs
```

The product regression suite makes a fresh disposable synthetic SQLite file, deliberately tampers stored values while preserving physical schema validity, and asserts both refusal and byte-for-byte non-mutation. It also tests the valid private HOLD path. This is **not** retailer evidence. Independently replay the original immutable [QA #3265](https://github.com/Zennay/Supa/pull/3265) tests against the repaired product commit; don't edit QA assertions or infer acceptance from unrelated branch CI.

## Integration boundaries

Product [parent #3262](https://github.com/Zennay/Supa/pull/3262) and its M3 SQLite stack must be reviewed/integrated in order before this child. Written retailer permissions [#74](https://github.com/Zennay/Supa/issues/74), real human matching PLUS/DekaMarkt 11×2 field collection [#78](https://github.com/Zennay/Supa/issues/78), pinned code SHA [#205](https://github.com/Zennay/Supa/issues/205), permanent M3 runner [#2833](https://github.com/Zennay/Supa/issues/2833), scoped zCloud writer lease and applicable review are still required. There is no live fetch, production ingest, pricing, data permission or deployment approval in this change.
