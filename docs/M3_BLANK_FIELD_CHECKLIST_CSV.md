# M3 blank PLUS/DekaMarkt collection checklist (product-core)

Supa is still **M3 ACTIVE**. This optional operator aid prints exactly **22 blank observation rows** from the existing canonical four-meal / eleven-ingredient `buildObservationSheet()` contract: one row per demand for the PLUS **baseline**, then the same eleven for the DekaMarkt **candidate**. The two retailer names come from `M3_EXPECTED_RETAILERS`, not duplicated CSV labels.

## Generate locally

```sh
node --experimental-strip-types scripts/m3-export-blank-field-checklist.mjs > m3-field-blank.csv
```

The exporter writes to **stdout only**; it never creates, overwrites or uploads an evidence file. Use a private local directory if retaining a filled copy; do not commit filled CSVs, personally identifying details, source URLs or checkout observations. The export itself is just a **blank collection aid**, not a finalized observation artifact.

## Collection rules

- Record **genuine**, personally witnessed product availability, pack unit/count, price in cents, source, captured time and notes; never fill missing data with prototype fixture prices. A blank cell means **unknown**, not zero or unavailable.
- Record both retailers in the **same price context** (in-store or online order), with timestamps no more than **24 elapsed hours** apart. Keep a pseudonymous study reference only in the controlled canonical study workflow, not in this CSV template.
- Compare the **same 11 canonical ingredient requirements** in both stores. Do not silently substitute fewer ingredients, reverse PLUS/DekaMarkt roles or treat promotion/ambiguous pack prices as verified.
- CSV has no participant key, price, observed time, source, availability or savings amount prefilled. Every row is explicitly marked `collection-template-not-evidence` to prevent treating it as proof. The exporter escapes quoted cells, neutralizes formula prefixes and refuses control characters.

## Mandatory canonical evidence path

**This CSV is not importable study evidence.** After collecting real data and separately satisfying the retailer permission/privacy rules, transcribe or verify the observations against the canonical `npm run m3:create-observation-sheet` JSON, then use the existing converter, field-readiness and `npm run m3:assess-observed-week` gates. Never infer public savings from a CSV, controlled source structural pass or example basket. [Human field-evidence issue #78](https://github.com/Zennay/Supa/issues/78) remains open until independently verified.

The branch is isolated, **DRAFT / HOLD / NO MERGE / NO DEPLOY** until exact-head hosted tests and relevant permanent runner checks and owner approval. No live application, retailer adapter, canonical converter, fixture price, M3 assessment or main branch is changed.
