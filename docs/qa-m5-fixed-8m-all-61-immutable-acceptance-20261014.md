# Supa complete original 61-case M5 trust verification on corrected 8 MiB aggregate owner — 2026-10-14

## Source and immutable QA proof chain
- Product source frozen on isolated [DRAFT owner #2189](https://github.com/Zennay/Supa/pull/2189), exact `208c9a20a6244df27a1441dfda31f086300f9b11`: lowers local successful M1 HTML budget to **≤8 MiB per file and ≤8 MiB total per capture directory**, preserving all prior root/symlink, SHA, chronology, P1, source-rights and private review fences.
- Exactly **12 byte-identical original independent test files** (61 distinct cases) imported without modification from [original QA #2164](https://github.com/Zennay/Supa/pull/2164) (34), [#2174](https://github.com/Zennay/Supa/pull/2174) (9), [#2171](https://github.com/Zennay/Supa/pull/2171) (4), [#2169](https://github.com/Zennay/Supa/pull/2169) (8), and [#2166](https://github.com/Zennay/Supa/pull/2166) (6). All copied Git blob hashes checked against prior frozen QA #2190. This child changes no original product, existing QA, main, workflow, permanent VPS, retailer or field evidence file.
- On old [product owner #2185](https://github.com/Zennay/Supa/pull/2185), exact [QA-only #2190](https://github.com/Zennay/Supa/pull/2190), [CI #38494055313](https://github.com/Zennay/Supa/actions/runs/38494055313): **840 total / 839 PASS / exactly 1 intended source-contract RED / 0 skipped or unrelated fails**. The single failing original 8 MiB aggregate case demonstrates the previous 32 MiB product policy mismatch; the other **60 original cases** passed together. This is the definitive old-source RED baseline for a truthful, unchanged RED→GREEN replay on owner #2189.
- Other earlier composed source proves: [QA #2188](https://github.com/Zennay/Supa/pull/2188) [CI #38493726331](https://github.com/Zennay/Supa/actions/runs/38493726331) **834/834 PASS** with 55 immutable other trust cases. Neither is a substitute for **new exact-head** CI on the fixed #2189 source.

## Unchanged original Git blobs
```
422c28eab8142c8e6a3310beee52209924a3a20b  4 physical-root
e4bb9e734e990e70c55d2756510fb55ac5be96e7  5 HTML/store link
745b97a9013119b165055085b0a241efa9bfd456  3 manifest/root link
bd933f6ce843a614f7b3478956864fc5bd198426  8 HTML shape
fa97541dfe7aad8d7cd065add4e6502fb28141c0  7 unavailable/P1
070def9b787de88ae3c59abb38fda89fb27be895  6 origin
b876440b57d7b462aa6d4a3e21d5936d98084f11  7 metadata
91aeba663302d6559b61ba019721251525a6e6e9  6 raw manifest
d392c8e82f2b522819533834b47d1afb94e10e90  6 chronology
103b626caa9cf18b7e6a26e819f66e5651d06048  3 cross-source chronology
b68dc2c691451f64e118b9395890cbdafdd29479  4 HTML byte budget
a99f133e90462e168f83dc9d2cb1821a27507199  2 aggregate budget
```

All fixtures are invented local SHA-verified HTML or in-memory objects, no retailer network, consumer prices, source-rights, production approval or savings evidence. Require exact QA HEAD full GitHub-hosted npm ci, npm audit high, all tests, M1 matching/source permission and TS/Vite build GREEN; no claim of permanent VPS/latest-main certification. Earlier separate [QA #2192](https://github.com/Zennay/Supa/pull/2192) tests the **old 32 MiB policy** specifically; do not confuse old historical boundary with corrected 8 MiB acceptance.

**Actual Supa state M3 ACTIVE**. Genuine human [field #78](https://github.com/Zennay/Supa/issues/78) same-demand 11 PLUS baseline + 11 DekaMarkt candidate in 24 hours remains OPEN. M4/M5 INELIGIBLE. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently verified zCloud SQLite scope/write preflight+claim lease, original product/QA owners, safe latest-main integration and relevant trusted permanent runner, human M3 field evidence and explicit releasego.
