# Independent postrepair QA — M5 selector metadata/identity issue #2128

**Date:** 2026-10-13. **Milestone:** Supa M3 ACTIVE, authentic PLUS+DekaMarkt 11+11 price field proof [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN; M4/M5 not eligible.

## Immutable ownership and test provenance

- Frozen independent product source: [DRAFT product fix #2131](https://github.com/Zennay/Supa/pull/2131), exact immutable SHA `e3b88649aa898d2a17153954135e5770bebc77a9`, based on separately owned original M5 queue #2126. This branch is *not* a source merge vehicle.
- Frozen QA base: `qa/frozen-m5-selector-fixed-e3b88649-20261013`. Independent QA branch: `qa/m5-original-seven-postrepair-proof-20261013`.
- Replayed test `tests/qa-m5-seven-original-postrepair-acceptance-20261013.test.mjs` is **byte-identical** to the *first* independent [DRAFT QA #2129](https://github.com/Zennay/Supa/pull/2129) test `tests/qa-m5-selector-metadata-identity-boundary-20261013.test.mjs`, original Git blob SHA **`b876440b57d7b462aa6d4a3e21d5936d98084f11`**. No weakened assertions or edits to original QA or product owner tests. Add-only new QA paths, no changes to source, workflows, `main`, or other workers' files.

## Expected acceptance

Original seven independent cases: three positives preserve deterministic distinct opaque source tokens, fail-closed human-only P1 review for canonical unavailable capture and legitimate schema-org drift; four former REDs must become **GREEN only due to corrected source**: (1) unpaired-surrogate UTF-8 replacement source-token identity collision; (2) forged verified schemaOrgStatus; (3) non-null unavailable capture digest; (4) unavailable capture falsely marked schema-org verified. The genuine validation test must not silently skip cases. No real retailer connections, prices, scraping, participants or source permission issued.

Run an exact QA-head GitHub-hosted workflow including `npm ci`, high npm audit, complete Node tests, M1 matching benchmark, source permission gate and TS/Vite build; collect actual run + immutable test counts only when completed. Permanent VPS or Firefox evidence, zCloud independent preflight/claim/write lease, QA and product owner review, latest-main integration and human go are **not supplied by hosted CI**.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.** Do not close issue #2128 or imply genuine #78 field proof/retailer rights from synthetic acceptance alone.
