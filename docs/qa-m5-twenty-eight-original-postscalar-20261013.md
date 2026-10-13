# Supa independent final four-contract M5 review-only QA (13 October 2026)

## Frozen source and strict release boundaries

Supa **M3 ACTIVE**: the first genuine same-demand 11 PLUS + 11 DekaMarkt human basket pair (24h, one price context) is still missing [#78](https://github.com/Zennay/Supa/issues/78). Future M5 expansion is *not eligible*. Nothing here connects to real stores, prices, rights, scraping, beta users or savings. This is offline deterministic product integrity validation only.

Product-owner corrected new M5 scalar inspector source: [DRAFT #2154](https://github.com/Zennay/Supa/pull/2154) immutable SHA `4e63910aa3eaabf5ce27c4aa5797c8223791752e`. Independent frozen QA base `qa/frozen-m5-twenty-eight-4e63910a-20261013`, independent add-only `qa/m5-combined-twenty-eight-4e63910a-20261013`, **four new test paths plus this provenance document**; no original product source/tests, existing QA branches, main, workflows or other workers modified.

Exactly **28 original independent QA tests copied byte-for-byte**, four separate historical defect contracts:
- 8 original M1 inspection scalar metadata tests [#2153](https://github.com/Zennay/Supa/pull/2153), Git blob `bd933f6ce843a614f7b3478956864fc5bd198426`; five initially RED, three positive.
- 7 missing/added failed capture priority tests [#2145](https://github.com/Zennay/Supa/pull/2145), original blob `fa97541dfe7aad8d7cd065add4e6502fb28141c0`; four initially RED, three positive.
- 6 wrong supermarket/kind source provenance drift tests [#2135](https://github.com/Zennay/Supa/pull/2135), blob `070def9b787de88ae3c59abb38fda89fb27be895`; four initially RED, two positive.
- 7 malformed UTF-16 source identity and forged capture metadata tests [#2129](https://github.com/Zennay/Supa/pull/2129), blob `b876440b57d7b462aa6d4a3e21d5936d98084f11`; four initially RED, three positive.

All **17 prior intentional RED** should be GREEN on this *one* corrected product source, while **11 prior positive** remain GREEN. No assertion was weakened; no source or test owner files touched. Unlike [independent QA #2155](https://github.com/Zennay/Supa/pull/2155) on older product #2151, this combined proof targets newest corrected scalar source and crosses all four behavior contracts in one immutable CI run.

Verify full exact-head hosted `npm ci`, high npm audit, complete Node tests, M1 matching benchmark, source permission gate and TypeScript/Vite production build before claiming result. A green hosted QA run is **not** a permanent VPS/Firefox/physical print check, a source licence, a latest-main integrated release, zCloud independent preflight/SQLite claim/write lease, field M3 observation, or a human release go.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.**
