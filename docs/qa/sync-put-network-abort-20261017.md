# SUPA QA1 — PUT cancellation propagation, keepalive and CAS (17 October 2026)

**Owner:** [DRAFT #3777](https://github.com/Zennay/Supa/pull/3777); exclusive product-code owner.  
**Independent QA:** [issue #3829](https://github.com/Zennay/Supa/issues/3829) and [QA DRAFT #3830](https://github.com/Zennay/Supa/pull/3830).  
**M3:** ACTIVE; written retailer permissions #74 and true paired PLUS/DekaMarkt 11×2 observations #78 remain HOLD.

## Reproduction

Frozen owner source `5380de0e90c8328f239d8e7eb22baf80640cb671`. Two test-only Node files bundle the **real** `src/lib/supaSync.ts` using existing `esbuild` and provide synthetic storage, an instrumented interval, `AbortController`, and an injected `options.request` callback. The actual `src/lib/syncTransport.ts` already forwards the supplied `signal` to same-origin browser `fetch`; the caller's PUT currently omits it.

```bash
npm ci
node --test tests/qa-sync-put-network-abort-20261017.test.mjs tests/qa-sync-put-abort-keepalive-conflict-20261017.test.mjs
```

Isolated zSSH Node original local run on the committed source **3 positive GREEN / 4 expected P2 RED / 0 unrelated**. Await the official **final-head GitHub hosted native CI** before describing these as hosted outcomes; superseded cancelled runs are not proof.

The four expected RED boundaries are (1) direct `pushSyncedState({signal})` no `signal` in first network PUT; (2) background `stop()` cannot cause a cooperative stalled PUT to abort; (3) direct aborted request does not forward the signal even though post-response metadata protection correctly refuses to commit; (4) both first and retrying PUTs during valid 409→200 `keepalive:true` CAS should carry the same signal.

Three positive controls affirm valid active 200 save, GET cancellation already reaching transport, and valid active keepalive 409→200 preserving the unsynced local planner while excluding a **synthetic private M3 sentinel**. Tests are not evidence of user data loss or a production incident.

## Owner-only acceptance and concurrency

- Add forwarding of the **existing optional signal** to the request init of **every PUT attempt**, preserving its body, headers, `keepalive` and the request's same-origin credentials. Do not remove the already-good postresponse `signal.aborted` fences for 200 and 409.
- Verify abort with an intentionally stalled cooperative mock and that the app's background timer/listener clear on stop. Validate the browser's `keepalive:true` + `AbortSignal` behavior to avoid silently changing unload/visibility behavior.
- Import **both independent QA test files byte-identically** and prove exact owner RED→GREEN native tests, full npm ci, high audit, M1 matching, actual rights false, build and applicable real-browser/VPS acceptance.
- QA has no source or merge lease; its PR is DRAFT / NONMERGE. Do not mark `main`, production rollout, real retailer data, M3 human gates or final release completed from a simulated run.
