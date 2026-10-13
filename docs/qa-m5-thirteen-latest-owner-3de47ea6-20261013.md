# Independent latest-M5-source cross-owner issue acceptance — 2026-10-13

**Source ownership:** corrected product [DRAFT #2141](https://github.com/Zennay/Supa/pull/2141) advanced by product worker to exact `3de47ea61749a09cf1ce9fa612200e04c3004bf1` (one **add-only real offline CLI test** beyond earlier `7e27209e42443ac1a77cf0d34c11d9074d9e22d1` — no product-source edits in that latest commit). Frozen independent QA base `qa/frozen-m5-crossowner-3de47ea6-20261013` and QA-only branch `qa/m5-original-thirteen-latest-owner-3de47ea6-20261013`; new test/doc files only, no original source/owner QA, other worker branch, main or workflows modified.

## Byte-identical independent original regressions

- Original six [issue #2134](https://github.com/Zennay/Supa/issues/2134) supermarket/kind drift assertions from [QA #2135](https://github.com/Zennay/Supa/pull/2135), exact Git blob `070def9b787de88ae3c59abb38fda89fb27be895`, copied unchanged as `tests/qa-m5-origin-six-latest-owner-3de47ea6.test.mjs`. Original 4 RED must stay GREEN from corrected source, plus 2 positive controls.
- Original seven [issue #2128](https://github.com/Zennay/Supa/issues/2128) invalid surrogate source identity and forged canonical verified/unavailable metadata from [QA #2129](https://github.com/Zennay/Supa/pull/2129), exact Git blob `b876440b57d7b462aa6d4a3e21d5936d98084f11`, copied unchanged as `tests/qa-m5-metadata-seven-latest-owner-3de47ea6.test.mjs`. Original 4 RED should remain GREEN after previous #2131 correction, 3 positive controls must remain unchanged.
- **13 original tests total**, zero weakened assertions, exact Git object SHA re-verification. Together they independently check that recent `origin_changed` P1 functionality doesn't regress prior Unicode-source identity/canonical capture metadata protection on the **latest** source-owner head.

Run exact QA-head hosted CI (npm ci/high audit, all tests, M1 matching/permissions, TS/Vite build), and report actual counts only when completed. A completed successful GitHub-hosted job is **not** current-main composition, a real retailers integration test, applicable permanent VPS, zCloud independent preflight/write claim/lease, or an approval to release.

**Supa M3 ACTIVE:** genuine human [PLUS+DekaMarkt 11+11 same-demand #78](https://github.com/Zennay/Supa/issues/78) OPEN; M4/M5 ineligible. Entirely synthetic offline test inputs. No real data/rights/proxies/scrapers/savings claim. **DRAFT/HOLD/NO MERGE/NO DEPLOY.**
