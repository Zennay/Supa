# SUPA QA1 — Background sync lifecycle and post-disposal safety (17 October 2026)

**Issue:** [#3826](https://github.com/Zennay/Supa/issues/3826) · **QA draft:** [#3827](https://github.com/Zennay/Supa/pull/3827) · **Product owner:** [#3777](https://github.com/Zennay/Supa/pull/3777)

## Frozen evidence and concurrency boundary

This add-only independent QA work exercises `src/lib/supaSync.ts::startBackgroundSync` from the **product owner's frozen SHA** `c2b4a4d978cce9ee9c244ffb9f99b18b3f40b588`. It does **not** edit product source, another worker's QA PRs, workflows, retailer rights data, `main` or deployment.

Two separate immutable files isolate the original terminal-lifecycle findings from the later 409 composition:

- `tests/qa-sync-background-stop-lifecycle-20261017.test.mjs`: 5 synthetic cases (2 valid controls and 3 expected P2 RED).
- `tests/qa-sync-background-stop-late-conflict-20261017.test.mjs`: 2 further cases (one valid CAS retry control and one expected P2 RED).

Both bundle the **real** TypeScript product code using existing esbuild; they do not reproduce the sync state machine or perform a network call. All `localStorage` and private M3 entries are synthetic, `fetch` is injected, `setInterval` and the global `visibilitychange` listener are instrumented. Controlled in-flight 200/409 responses are resolved **after** explicit disposal.

## Reproduction

```sh
npm ci
node --test tests/qa-sync-background-stop-lifecycle-20261017.test.mjs tests/qa-sync-background-stop-late-conflict-20261017.test.mjs
```

On the frozen owner, isolated zSSH native Node gave **3 positive controls GREEN, 4 targeted P2 RED** and zero unrelated tests failed. These are local synthetic tests, **not** a real production incident; official GitHub-hosted exact-head CI must independently certify the 3/4 attribution before treating it as hosted evidence.

Expected RED boundaries:
1. Static-host `404` return value `no-api` marks `stopped=true`, but does not remove timer/listener.
2. Permanent `422` return value `rejected` leaves the same dormant resources.
3. `stop()` while a PUT is pending clears resources but a later `200` acknowledgement writes sync metadata after the disposer returns.
4. `stop()` while a PUT is pending still accepts late `409` remote checklist and starts a second CAS PUT after disposal.

Controls: `503` remains retryable, manual idle stop clears resources, and normal active `409` rebase followed by `200` preserves local unsynced planner, remote checklist and metadata.

## Owner-only acceptance

1. Terminal `no-api`/`rejected` outcomes must **actually** retire the interval and document listener. Stop should be idempotent; temporary `503` and transient transport failures must remain retryable.
2. Explicit `stop()` must fence commits from pending responses. Simply clearing timers is insufficient. A scoped cancellation/generation guard around the async PUT response **and** late 409 remote adoption/retry may be needed; ensure the guard is checked before changing browser records or scheduling a second request. A best-effort `AbortController` can complement this but cannot guarantee a transport cooperates.
3. Preserve the legitimate 409 conflict/rebase CAS and 200 acknowledgement on **active** clients. Do not drop unsynced local changes or write private M3 drafts.
4. Import original test blobs unchanged and prove native test-first RED → owner exact SHA GREEN, full `npm ci`, `npm audit --audit-level=high`, all Node tests, M1 matching, actual source permissions gate `productionReady:false`, TypeScript/Vite build and any applicable browser/VPS acceptance.
5. This QA PR is **DRAFT / NONMERGE** until the exclusive product owner controls source and final merge lease. Real PLUS/DekaMarkt permission #74 and genuine M3 11+11 observations #78 remain HOLD.

Final GitHub run/checkout and complete original runner log must be inspected before publishing counts; cancelled superseded runs do not establish RED or GREEN.
