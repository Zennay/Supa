# Independent Supa fork-PR runner admission QA — 14 October 2026

## Existing issue and non-conflicting ownership
- **Existing security QA issue [#365](https://github.com/Zennay/Supa/issues/365)** already defines same-repository PR restrictions before any permanent self-hosted runner allocation. Do not create a duplicate issue.
- [Existing QA PR #523](https://github.com/Zennay/Supa/pull/523) owns **M2** and **VPS mobile** workflows plus a standalone contract test; the earlier M1/M3 owners remain distinct. This new suite touches **none** of those paths or source files.
- New product worker [DRAFT #2167](https://github.com/Zennay/Supa/pull/2167) adds a *different* self-hosted workflow at `.github/workflows/product-persisted-week-vps.yml`, frozen at head `91a090d483cf988b0ea735e5be8a5fd3a14f008d`. It currently has `on: pull_request` and `runs-on: self-hosted` with no **job-level same-repository head guard**. Read-only token/disabled checkout credentials, localhost and host verification are good but **not sufficient** to keep untrusted fork code off a persistent runner that executes `npm ci`, `npm run build` and browser scripts.
- Independent **QA-only ADD**: `tests/qa-persisted-week-selfhosted-fork-boundary-20261014.test.mjs` plus this document. No changes to the active product workflow, other owners, main, M3 source data or existing QA tests.

## Exact acceptance
- **Positive** synthetic YAML fixture with the canonical #523 gate directly at job level passes, while missing or step-level gate fails the same parser. Prevent a vacuous static test.
- **Positive** the new existing workflow keeps its `pull_request` paths + manual `workflow_dispatch`, read-only `contents:read`, `persist-credentials:false`, pinned hostname, localhost-only server and bounded 15-minute timeout.
- **Expected source RED**: the one real permanent self-hosted `rendered-persisted-week` job must declare `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` directly before `runs-on: self-hosted`. This prevents the job from acquiring a persistent runner for an arbitrary public fork while preserving same-repo PR and authenticated manual dispatch.

The acceptance is intended to be independent of hosted Firefox correctness, student planning, prices or retailer source rights. **Do not bypass** by removing PR tests, using `pull_request_target`, moving `if` to a later checkout step, changing repo permissions to write, or turning the permanent machine into a general-purpose untrusted PR sandbox. Product worker should own the minimal workflow amendment separately; replay original QA bytes afterward and require exact-head hosted checks, and independent zCloud SQLite admission for any permanent VPS proof. Initial hosted CI expected two positives GREEN and one targeted RED; intentionally red source is not full CI success.

## Release
Supa is **M3 ACTIVE**. Genuine human same-demand 11-item PLUS and DekaMarkt within 24h [#78](https://github.com/Zennay/Supa/issues/78) remains open; M4/M5 not eligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending owner review, independent zCloud SQLite preflight/claim/write lease, current-main integration, applicable trusted VPS browser evidence and explicit human releasego.
