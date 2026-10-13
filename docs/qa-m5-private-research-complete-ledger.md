# Independent M5 private research-ledger QA (frozen product source)

**Owner:** [PR #2090](https://github.com/Zennay/Supa/pull/2090). Exact tested source: `872e5edf988990e544594559105f7020cd2b173c`. This work is **quality-validation only**, add-only tests/docs; no changes to product owner scripts, original tests, workflows, M1/M3 baselines or branches.

Run `node --test tests/qa-m5-private-research-complete-ledger-oracle.test.mjs`.

## Matrix

1. Populate all **17** current market-list retailer IDs with fictional, distinct, fully-specified manual research records, spanning each allowed source kind (`official-api`, `official-feed`, `no-public-source`, `unassessed`), rights claim (`claimed-written-permission`, `request-pending`, `denied`, `unknown`), scoped research, evidence URL fields, contact/completeness, cadence and priority. This is not actual supplier contact or approved rights. Assert `reviewedCount=17`, `missingCount=0`, still **all 17 unverified and disabled**.
2. Reorder the 17 records (reverse and rotate). The real assessment must remain exactly stable and sorted; input bytes and discovery register must not change.
3. Run the **actual** M5 CLI against a mode-0600 disposable full ledger file. Assert clean exit, only compact non-PII research summary, no private URL/token/path or raw records in stdout/stderr, unchanged on-disk private input.
4. Add one unmistakably fake private reviewer email field; both domain and real CLI must fail closed, using the same generic diagnostics with no identifier/path leakage and no mutation.

**Privacy:** only the reserved `example.invalid` domain and disposable local files are used. These are *fabricated fixtures*, not real users, retail URLs, credentials, licenses or field receipts. Even the `claimed-written-permission` rows must retain `rightsVerified=false`, `productionEnabled=false`, `m5Eligible=false`, and `productionReady=false`.

**No network/retailer/proxy access, deployment, scraping, real-source permission, public claims or beta research** is performed. The actual M3 true PLUS+DekaMarkt [field #78](https://github.com/Zennay/Supa/issues/78) remains OPEN.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until independent zCloud preflight/write lease, original product owner review, green exact-head hosted & applicable permanent VPS validation, latest-main/product compatibility and explicit human release authorization.
