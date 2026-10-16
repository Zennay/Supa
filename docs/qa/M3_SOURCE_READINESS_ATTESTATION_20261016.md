# SUPA M3 — independent offline source-readiness attestation

**Scope:** the project is in **M3**, not a public-price launch. This command is a reproducible historical QA/operational review only; it cannot grant PLUS/DekaMarkt scraping permission or prove grocery savings.

## Run

From the repository root with the normal Node/Python project dependencies installed:

```sh
node --experimental-strip-types scripts/qa-m3-source-readiness-attestation-20261016.mjs --as-of 2026-10-15T00:00:00Z
```

The output is a **single JSON line**, with `verdict:"HOLD"`. It contains only aggregated source/product/observation counts, the current canonical permission statuses, and explicit false values for public price/field-basket/savings/VPS proof. It contains **no raw URLs, item names, customer data, product prices or private credentials** and performs no retailer HTTP.

Use `node --test tests/qa-m3-source-readiness-attestation-20261016.test.mjs` for the focused acceptance contract, and the standard `npm test`, high-severity audit, matching benchmark, M1 permission gate and build before merging any QA release change.

## Controls, not substitutes

The command reuses the existing historical six-shape reviewed fixtures, private short-lived SQLite builder, original fact-parity attestation, whole-source preflight and anonymous source/availability/freshness health. The temporary DB is removed on completion. It independently inspects the **checked-in** `evidence/m1/source-permission-gate.v1.json` first; the CLI deliberately cannot accept a custom rights document or destination path.

The historical M1 register currently says `plus:permission_required`, `dekamarkt:unresolved`, and production ingestion stays **disabled**. If written rights or license terms change, this pinned historical attestation intentionally refuses instead of quietly switching to `GO`: a new reviewed authorization/release process is required. Never patch the JSON statuses merely to pass this test.

### Interpreting the result

- **`archivedSixShapeParityVerified: true`** only means existing historical offline captures match the six-source private SQLite reconstruction. It does **not** mean current prices, legal permission, live capture health, equivalent packs or user savings have been proven.
- **`fieldBasketElevenByTwoVerified: false`** means the genuine same-demand PLUS baseline + DekaMarkt candidate 11×2 basket in one context and a ≤24-hour window is not proved *by this command*. Follow [field evidence #78](https://github.com/Zennay/Supa/issues/78), not a fictional test basket.
- **`permanentVpsRunnerVerified: false`** is a separate real-run requirement tracked at [#2833](https://github.com/Zennay/Supa/issues/2833); GitHub-hosted tests are not self-hosted VPS proof.
- **`productionIngestionAuthorized: false`** is tied to the canonical [M1 source permission gate and #74](https://github.com/Zennay/Supa/issues/74), not to whether a technical scraper is able to fetch a page.
- **`observedSavingsClaimVerified: false`** also requires a documented independent assessment of real identical basket observations and the exact reviewed source SHA [#205](https://github.com/Zennay/Supa/issues/205).

## Safe reviewer checklist

Review the *exact branch commit*, unchanged private source register, offline original fixture parity, human-field results, and the real runner evidence independently. A failed attestation means **HOLD** and needs investigation; do not suppress failing tests, promote synthetic prices, add a live-fetch workaround, relax canonical rights or treat this QA command as a rollout authorization.

**Ownership:** QA lane 2/2 owns only this new standalone attestation source/test/guide. Product-core, original retailer adapters, the UI, active CI workflows, VPS and permissions remain with their existing owners.
