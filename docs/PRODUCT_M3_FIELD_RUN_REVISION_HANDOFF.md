# M3 genuine field-run code revision pin — product-core #205 (draft)

The human M3 collection requires the exact current `main` commit SHA **at collection start**, not the SHA that happened to introduce the field-run workflow. The current source-owner collector, converter and assessor do not yet persist it end-to-end. An unpinned field study must not be represented as reproducible evidence.

## Opt-in implementation (not yet wired)

`src/domain/m3FieldRunRevision.ts` exports:
- `parseM3FieldRunCommitSha(value)`: accepts only a provided, precisely 40-character **lowercase** hexadecimal commit identifier. No trimming, coercion, inference or current-HEAD lookup.
- `requireM3FieldRunCommitSha(study)`: fail-closed collection/conversion boundary with a privacy-safe generic error; a missing, malformed, array or object value is rejected.
- `m3FieldRunRevisionForReport(study)`: returns a whitelisted `{ fieldRunCommitSha }` metadata object, copying none of the study's prices, source notes or participant details.

Synthetic regression tests exercise valid pins, unsafe shapes, wrong length/case, fabricated aliases, input immutability, and strict report-data minimization. **This proves only syntax and deterministic handoff of a supplied value, not that it identifies the real collection-time main revision.** The actual run record must still be checked by the operator.

## Source-owner integration and acceptance

This is deliberately isolated from existing owners `src/domain/m3ObservationSheet.ts` (#154), `scripts/m3-build-observed-study.mjs` (#156), `scripts/m3-assess-observed-week.mjs` (#128) and independent RED QA [#1135](https://github.com/Zennay/Supa/pull/1135). Required next work: agree on field name `study.fieldRunCommitSha`; save it on the sheet, preserve it through the converted study, refuse malformed/missing values, include the same pin in the privacy-safe assessment, then replay unchanged independent QA with exact-head hosted CI plus permanent VPS/M3 validation.

No observed store prices, receipts, identities or human field results are created. No savings claim or automated retailer-data permission. Keep this implementation **DRAFT/HOLD/NO MERGE/NO DEPLOY** until source-owner composition. Genuine issue [#78](https://github.com/Zennay/Supa/issues/78) still requires the actual same-demand PLUS+DekaMarkt pair within 24 hours.
