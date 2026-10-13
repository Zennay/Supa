# Offline proxy health pool: canonical per-endpoint input (13 October 2026)

**Milestone:** Supa remains **M3 ACTIVE**, real human PLUS + DekaMarkt 11+11 #78 evidence missing. M5 future-ingest experiments are not eligible for rollout and this document does not authorize scraping, scraping around retailer restrictions, or access to any third-party proxy.

## Owner and issue
- Independent product-core fix of [QA issue #2081](https://github.com/Zennay/Supa/issues/2081), based on immutable original owner [DRAFT #2070](https://github.com/Zennay/Supa/pull/2070) SHA `6de0e4f3754b48c27d080b8690e3c2b127a3ab5f`.
- Original owner branch, [frozen expected-RED QA #2082](https://github.com/Zennay/Supa/pull/2082), current `main`, workflows and real network interactions are untouched.
- `parseProxyCandidates(text)` remains a deliberately permissive *multiline feed parser*, sanitizing and deduplicating sources. `ProxyHealthPool.refresh(candidates)` treats **each array item as one canonical endpoint** and now accepts it only when the parser returns exactly that same literal URL byte-for-byte. CRLF, extra lines, whitespace, unsupported ports, invalid/nonpublic second lines and altered input cannot enter `entries`, `dueForProbe`, `select` or a forged success state.
- The original **five independent QA cases are copied byte-for-byte** to a new product replay test path. Three supplemental tests cover 12 in-memory altered endpoint forms, valid deduplication, and expired authorized owned-echo results. All test probes are fabricated; zero HTTP/retailer requests.

## Offline verification
```sh
node --test tests/retailer-proxy-pool.test.mjs tests/product-proxy-canonical-replay-20261013.test.mjs tests/product-proxy-refresh-canonical-20261013.test.mjs
npm test
npm run build
```

This is **not** evidence of working free proxies, retailer rights, or production feed readiness. Unknown third-party proxies are unsafe for credentials and private information; no proxy is permission to bypass robots, login, bans or rate limits. No network test is performed by these regression suites.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** pending zCloud write preflight/lease, owner + QA review, immutable corrected-head hosted CI and applicable permanent VPS, latest-main integration, unchanged M3/M4 milestone gates and explicit human release authorization.
