# QA — consent-scoped PLUS/DekaMarkt private product preview (16 October 2026)

**Scope:** independent quality-validation worker 2/2; six additional executable Node tests targeting the existing product-core owner's bounded opt-in HTML capture → private Schema.org product bridge.

This test-only lane is intentionally **stacked on the frozen product-head** of [PR #3125](https://github.com/Zennay/Supa/pull/3125). The QA branch contains **no product, adapter, permission evidence, workflow or release changes**, and must not be independently merged into `main` until its product dependency has been merged and the QA suite is rebased to the actual current canonical main with exact-head tests.

## Independent acceptance scenarios

1. **Two fictional retailers, one source identity each.** Separate explicit injected PLUS and DekaMarkt transports yield a single private, SHA-bound Product observation at the correct captured time. No HTML, rights marker, session key, current price, verified stock, checkout confidence or public savings in result.
2. **No price fallback from corrupted JSON-LD.** A broken declared first script followed by a plausible cheap fictional second Product must abstain as a whole. Distinguish HTTP-body verification (valid HTML) from a verified product fact (none).
3. **Invalid UTF-8 / failure cooldown.** A mocked HTTP 200 response with invalid UTF-8 is not a verified capture; after the usual 10-second rate gap but before 60-second cooldown a second network call must not run. A valid synthetic capture after cooldown can proceed.
4. **Independent retailer budgets.** A mock PLUS HTTP 429 blocks PLUS for the session but cannot accidentally block a separate properly granted DekaMarkt review.
5. **Streaming concurrency and per-host lock.** While PLUS body validation remains pending, second PLUS cannot fetch, while DekaMarkt may independently finish. PLUS only unlocks after full body integrity validation.
6. **No SSRF or unauthorized route promotion.** Lookalike hosts, query tokens, fragments, HTTP downgrade, wrong path and catalog/offer request kinds refuse *before* injected transport, consuming zero quota.

## Source and commercial rights boundaries

All permission records are **fictional in-memory Node test inputs** and explicitly not lawful retailer authorizations. The production M1 source-rights register remains PLUS `permission_required` and DekaMarkt `unresolved`; operator capture is forbidden without independent documented consent. No real retailer HTTP, account access, network interception, proxy rotation, source rights grants, checkout/public prices, public savings or M4 go-ahead.

Run `node --experimental-strip-types --test tests/qa-authorized-product-preview-isolation-20261016.test.mjs` and the exact-head complete repository Node/audit/M1 matching/source permission/build workflow. Standard hosted green is only code evidence, not permanent trusted M3 VPS runner proof. Scope-lease, own/peer-PR ownership and relevant VPS CI must be checked for eventual merge. Genuine manual PLUS/Deka matched 11+11 basket evidence within 24 hours, real field SHA and source license are still external [#78](https://github.com/Zennay/Supa/issues/78), [#205](https://github.com/Zennay/Supa/issues/205), [#74](https://github.com/Zennay/Supa/issues/74), [#2833](https://github.com/Zennay/Supa/issues/2833).
