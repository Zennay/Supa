# SUPA independent offline proxy-health state matrix (#2069)

**Quality-validation only / DRAFT / HOLD / NO MERGE / NO DEPLOY.**

Target original source is the **frozen** [proxy-pool owner PR #2070](https://github.com/Zennay/Supa/pull/2070) head `6de0e4f3754b48c27d080b8690e3c2b127a3ab5f`, pinned to `qa/frozen-proxy-pool-6de0e4-20261013`. This QA work is **separate from** the expected-RED malformed URL issue [#2081](https://github.com/Zennay/Supa/issues/2081) and independent [PR #2082](https://github.com/Zennay/Supa/pull/2082), which remain open and must **not** be treated as green by this suite.

Four runnable offline test groups use the actual `ProxyHealthPool` implementation, no external network or credentials:

1. Exact expiration of two owned-endpoint positive results with different ages/latencies, fastest fresh selection, source refresh deadlines.
2. Eight consecutive failures with bounded exponential backoff, no early cooldown bypass and recovery only from fresh owned-HTTPS-echo success.
3. Removed candidate loses health proof; readdition cannot resurrect an old verification, expiry remains fail-closed.
4. One hundred deterministic simulated feed churn/duplicate/probe cycles, anti-bypass denial and zero selected healthy endpoints after the TTL.

The suite deliberately uses example public IPv4 literals as **inert test data**, not operational proxies. The simulated `ownedEndpoint` flag is a controlled contract input, not proof that any real endpoint is authorized. It neither scrapes retailers nor rotates proxies to evade blocks or price/terms restrictions.

Before accepting the source in the final product, require original owner's source-integrity repair #2081, independent zCloud writer lease/preflight, latest-main compatibility, exact-head hosted/VPS tests, per-retailer source permissions and explicit go. Current Supa M3 human [#78](https://github.com/Zennay/Supa/issues/78) remains open; M4/M5 not authorized.

## Permanent-runner acceptance

The additive read-only `.github/workflows/supa-qa-proxy-health-vps.yml` runs only for same-repository pull requests on the permanent `vps-bb300bba` runner, checks out the **explicit PR head SHA** without persistent credentials, verifies hostname and exact checked-out commit, executes the standalone offline suite, full npm test suite and production build. No action writes into the live portfolio queue, production inventory, retail network or applications. This is a release evidence check, not deployment or source permission. A queued/self-hosted run is **NOT** proof of success until the exact-job logs confirm completion.
