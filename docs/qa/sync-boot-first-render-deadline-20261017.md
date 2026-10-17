# SUPA QA1 — Browser sync first-render deadline proof (17 October 2026)

**Issue:** [#3824](https://github.com/Zennay/Supa/issues/3824) · **Owner product PR:** [#3777](https://github.com/Zennay/Supa/pull/3777) · **QA draft:** [#3825](https://github.com/Zennay/Supa/pull/3825)

## Frozen ownership and evidence boundary

This branch is **quality-validation 1/2** and touches only add-only QA files. The product owner is exclusively responsible for `src/lib/syncBoot.ts`, sync-client code, branch integration, source/main merge leases, deployment and any live browser acceptance. Original owner source commit for test-first proof: `eb4ec434bf58fd9123ca418e8dca21cdde2bbf6e`.

There are **no real customers or retailer observations** in this test. All browser storage and fetch responses are synthetic. The private `supa:m3-observation-draft:v1` sentinel must never be sent or modified. Neither successful build nor these tests authorize retailer data: written source rights #74, real 11+11 field observations #78, source pin #205 and runner #2833 remain HOLD; `productionReady:false`.

## One bounded native Node regression suite

`tests/qa-sync-boot-absolute-deadline-20261017.test.mjs` imports the **actual product entrypoint** via an in-memory esbuild bundle so tests also run when the VPS's Node 22 build lacks native TypeScript stripping. This is **not a duplicate implementation** of the boot code.

```bash
npm ci
node --test tests/qa-sync-boot-absolute-deadline-20261017.test.mjs
```

- **Positive control 1:** unavailable GET 404 settles promptly, registers background polling, leaves private M3 unchanged.
- **Expected P1 RED 1:** injected `fetch` promise never settles or responds to `AbortSignal`; a nominal 15ms deadline cannot leave first render hanging >350ms.
- **Expected P1 RED 2:** HTTP 200 JSON response arrives but its body stream never ends; abort alone must not make the initial render await indefinitely.
- **Expected P1 RED 3:** delayed GET returns a valid full snapshot **after** the bootstrap deadline. A late transport resolution must not alter the already rendered local planner, and background retries should still be registered.
- **Positive control 2:** a *timely* valid full JSON GET still restores a fresh device's planner and revision, with private M3 intact.

Local isolated zSSH run on 17 October with original owner commit yielded **2 positive PASS and exactly 3 targeted RED**. This is not a claim of native GitHub-hosted CI proof, a real user incident or released product.

## Exclusive owner RED → GREEN acceptance

1. Enforce the first-render timeout using an independent deadline (for example `Promise.race`) even when the transport or response reader ignores abort; still use abort for best-effort cancellation.
2. Prevent a timed-out GET from committing **any late localStorage updates** after first render. A promise race around the caller alone is insufficient if `pullSyncedState` keeps running. A scoped generation/abort guard **at the admission/commit boundary** is needed. Preserve the device's unsynced local edits and CAS behavior.
3. Preserve timely success, unavailable/static-host fallback and background polling. Keep the private M3 draft strictly local.
4. Import the **same frozen QA test blob** unchanged into the exclusive owner branch, run native exact-head full suite, `npm ci`, `npm audit --audit-level=high`, M1 matching, actual source-permission gate (`productionReady:false`), TS/Vite build, then applicable browser/VPS evidence.
5. Only after a verified exclusive main/merge lease, code review and release criteria may the product owner promote the fix. Do **not** merge this expected-RED QA draft as a passing change.

## Source of truth

Read the QA PR's latest head and Actions checkout SHA before attributing counts. Cancelled Actions runs superseded by a newer push are neither GREEN nor meaningful RED. Historical local counts belong to the exact test version under review.
