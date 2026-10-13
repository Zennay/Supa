# Independent green QA — frozen M5 review pack and rights outputs

**Owner source pinned:** [DRAFT product #2090](https://github.com/Zennay/Supa/pull/2090) at `2704fbec375c13b34c4c54570b0713f26a427f27`. Isolated quality-validation branch with **only new test/docs files**. Not source-owner modification, not release approval.

## Executable acceptance

`node --test tests/qa-m5-owner-head-independent-output-oracle.test.mjs`

Four separate, **intentionally all-GREEN** tests:
1. Cross-check the canonical 17 retailer IDs and order one-to-one across discovery audit, JSON research/review pack, actual M1 two-retailer rights reconciliation, with both known M1 chains marked *historic technical research only*. Every source remains disabled, unapproved and immutable.
2. Independently parse all real CSV quoted records and 14 columns (including cell escaping), then compare each id, label, research evidence URL, M1 flag, unresolved rights, null evidence and disabled status to the original JSON output. No fragile naive comma splitting.
3. Independently verify the 17 Markdown candidate rows, market research URLs, disabled status, existing M1 research labels and explicit non-license disclaimer.
4. Ensure the current owner's **unreviewed-only discovery** contract rejects approval, denial and requested-permission states in the exploratory inventory itself; decisions require the separate rights-review evidence workflow.

No live retailer visits, no source scraping/proxies, no credential or real identity handling, no M3 field evidence and no public savings claim. A market-list citation does not imply a product-page feed or permission.

These GREEN tests are deliberately split from the **expected RED** unknown-rights-metadata reproduction in [issue #2097](https://github.com/Zennay/Supa/issues/2097) / [QA #2099](https://github.com/Zennay/Supa/pull/2099). That defect remains an independent owner-remediation prerequisite and cannot be hidden by green tests. No original PR branch, main, workflows, existing tests or original source touched.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending zCloud preflight/write lease, product owner review, exact-head hosted CI plus applicable permanent VPS validation, latest-main compatible composition and explicit human release approval. M3 [real field #78](https://github.com/Zennay/Supa/issues/78) OPEN; M4/M5 not eligible.
