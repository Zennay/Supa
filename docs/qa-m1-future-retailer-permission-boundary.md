# SUPA quality validation — M1 permission gate versus future retailer expansion

**Independent QA, synthetic only. DRAFT / HOLD / NO MERGE / NO DEPLOY.**

Canonical source branch: `main` at `c36f5c8f71d77cae94663978b51a194e9b183af6`. Current portfolio phase remains **M3 savings proof**. Issue [#2069](https://github.com/Zennay/Supa/issues/2069) is an M5 expansion proposal, **not** authorization to scrape, ingest or claim coverage of Dutch supermarkets.

## Regression scope

`tests/qa-m1-new-retailer-permission-boundary.test.mjs` exercises the actual exported M1 gate and the real production-readiness CLI offline, never contacting supermarket sites or proxies.

- Existing PLUS and DekaMarkt proof remains technical only and the source-permission gate stays `productionReady=false`.
- Eleven speculative additional supermarket IDs must be **rejected**, even if a test fixture falsely marks them `permitted` and supplies fictional written-permission metadata. This prevents a new M5 source from silently riding on the old two-source M1 artifact.
- Duplicate/missing source rows cannot weaken the exact-source contract; display order alone has no effect on readiness.
- New registry terms `approved`/`pending`/`denied`/`unknown` are deliberately **not accepted** by the existing version-1 M1 gate. A future schema migration must explicitly define and test their meaning; do not map an unknown value to `permitted`.
- Public technical access, HTTPS pages and official terms without explicit licensing evidence do not enable production reuse. A prohibited/unresolved source still blocks the pair when its sibling has synthetic test-only authorization.
- Non-HTTPS, relative or malformed evidence URLs are rejected. The unchanged `--require-production-ready` CLI exits 2, and the original permission evidence bytes remain untouched.

The deliberately fictional `example.invalid` authorization inside unit tests has **no legal or evidence significance**; it exists only to verify control-flow isolation.

## Separate release/permission gates

1. For M5, first design a new per-source register, review real terms/licenses, document who authorized each source, preserve `unknown = not approved`, and make **every new source disabled by default**.
2. Require independent authorization and fresh fixture/permission tests before any live price ingestion or scheduled retailer requests. Never use a public proxy to bypass a block, rate limit or source terms.
3. For current M3, genuine [PLUS/DekaMarkt field issue #78](https://github.com/Zennay/Supa/issues/78) remains mandatory before claims or M4 recruitment. Synthetic M1 gating does not make M3 eligible.
4. Exact-HEAD CI, zCloud preflight/lease, owner review and explicit release approval are mandatory before integration. No consumer information, private source capture, network fetch, deployment or merge is performed by this QA PR.
