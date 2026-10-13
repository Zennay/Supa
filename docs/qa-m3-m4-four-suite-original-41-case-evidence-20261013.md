# SUPA current M3 + preparation M4 — four independent QA suites as one frozen proof

**Review-only source:** frozen current combined product [DRAFT #2115](https://github.com/Zennay/Supa/pull/2115) at immutable `682dffbf5b02e00b880a6d40d1f599b6cedac111`. No edits to source, main, original independent QA PRs, other workers' branches or actual observation evidence.

## Four exact-original unmodified acceptance suites (41 checks)

| Original QA / issue | Checks | Exact unchanged Git blob |
| --- | ---: | --- |
| [#2094](https://github.com/Zennay/Supa/pull/2094) / [#2093](https://github.com/Zennay/Supa/issues/2093): planning week vs observation dates | 6 | `fa8742c710ba07dc5ef8ac94de246a57b462f9b9` |
| [#2096](https://github.com/Zennay/Supa/pull/2096) / [#2095](https://github.com/Zennay/Supa/issues/2095): derived private report must not echo direct identity | 14 | `800a4e48e3a1ce777906bfb9fcd842bbde600d6d` |
| [#2109](https://github.com/Zennay/Supa/pull/2109) / [#2107](https://github.com/Zennay/Supa/issues/2107): completed beta-week causal plan/close order | 9 | `98dbdfd41d3a32de812261eb62702fe7bb9990a8` |
| [#2112](https://github.com/Zennay/Supa/pull/2112) / [#2110](https://github.com/Zennay/Supa/issues/2110): repair completion causal start | 12 | `e6245a3b7ea2d30b572b6de87e24c8f42a17404a` |

All four test files were copied **byte-for-byte**, including their original expectations, into new isolated `tests/qa-41-*.test.mjs` paths. On original frozen `main=c36f5c8f71d77cae94663978b51a194e9b183af6`, 6 + 5 + 4 + 12 = **27 intended RED** across the four suites; on this corrected combined source, **all 41 must pass** without suppression, altered assertion, synthetic product mocks or false monetary claims. Their original positive controls (3 + 7 + 2 + 2 = 14) must remain green. Each complete suite includes at least one actual CLI path where specified.

## Required verification

Exact branch HEAD hosted CI must pass `npm ci`, high npm audit, full `npm test`, M1 matching benchmark, M1 source permission gate and TypeScript/Vite build with no skips. Both applicable permanent VPS and source-owner review are separate. Preserve this immutable parent SHA so newer concurrent product changes cannot retroactively alter evidence.

**M3 genuine human gate [#78](https://github.com/Zennay/Supa/issues/78) OPEN.** All 11+11 PLUS/DekaMarkt baskets and beta weeks in tests are fictitious; no observations, permissions, real participant research, retailer access, live prices or public savings are generated. M4/M5 **not eligible**. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud preflight/write claim/lease, original owners, current-main integration, permanent runner and explicit human release authorization. This is independent evidence, not a merge/release vehicle.
