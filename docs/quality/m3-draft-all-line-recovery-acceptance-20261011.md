# SUPA M3 draft restoration — exhaustive independent quality acceptance (2026-10-11)

## Scope and reason

Canonical project gate remains **M3 full-basket comparison and observed savings proof**. The local `m3-manual-cart-observation-sheet` is editable collection support, **not** observed price evidence or a publishable savings result. A locally restored draft may retain editable text/products, but must never silently change the immutable planned ingredient demand, swap retailer observations, resurrect stale unavailable money, accept evidence-promotion metadata or widen the 24h field protocol.

This independent QA branch is **add-only** from immutable `main=22edb59b7c96311b686161b74a9fc2060e3c5d77`. It does not modify production logic, original tests, workflows, the PLUS/DekaMarkt observation inputs, or another worker's branch.

## Runnable acceptance

- `tests/qa-m3-draft-all-position-demand-invariants.test.mjs`: **55** canonical ingredient property mutations (11 rows × `id,label,query,amount,unit`), **88** retailer-side demand mutations (2 stores × 11 rows × `ingredientId,ingredientLabel,requirement.amount,requirement.unit`), plus nine reorder/drop/duplicate probes. Each must yield `restoreObservationSheetDraft(...) === null`; the untouched canonical draft remains recoverable with independent objects.
- `tests/qa-m3-draft-22-line-availability-state-matrix.test.mjs`: **44** independent unavailable/unknown probes (2 stores × 11 rows × false/null) wipe every stale product ID, label, pack, price, provenance URL and note, with no store bleed. **22** available-state probes preserve legitimate zero-cent fixture inputs but do **not** promote the sheet to retailer evidence or mark a one-line draft as ready. Root schema/version/evidence/planner/meal-count mutations reject, and untrusted added monetary fields or 48h policy overrides are not retained.
- Inputs are strictly synthetic, labeled as such. Zero cents is a numeric edge-case fixture, **not** a real observed retailer offer or savings.
- Run locked install, all Node suites, audit, M1 benchmark, source-permission gate and TypeScript/Vite build on exact branch HEAD; request permanent VPS/mobile/browser evidence only where applicable.

## Release and ownership boundary

**DRAFT / HOLD / NO MERGE / NO DEPLOY.** No synthetic fixture closes genuine two-store human observation [#78](https://github.com/Zennay/Supa/issues/78), cross-basket descriptor atomicity [#1508](https://github.com/Zennay/Supa/issues/1508), or submillisecond observation clocks [#1513](https://github.com/Zennay/Supa/issues/1513). Integration requires verified zCloud owner/lease, original owner review, exact final-head CI, applicable permanent runner/Firefox check and safe current-main comparison. Do not claim production permission or public savings from this suite.

## Per-item completion navigation

- `tests/qa-m3-draft-next-missing-22-slot-navigation.test.mjs`: for **every one of 22 possible last-unmeasured physical ingredient/store positions**, recover persisted JSON and require `availabilityRecorded=21`, `completeLines=21`, and an exact next-incomplete target pointing to that same store/ingredient. The draft must keep the reset-protection flag and remain unready/non-evidence.
- Once all 22 synthetic lines are explicitly measured as unavailable, item navigation can complete, but missing real store/study metadata must still keep the observation sheet **not ready**, with no evidence promotion or financial inference. This is a collection-state boundary, never proof of real stock status.
