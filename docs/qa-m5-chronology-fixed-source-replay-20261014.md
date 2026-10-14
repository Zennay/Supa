# Independent original QA replay on corrected M5 chronology owner — 14 October 2026

## Scope & proof provenance
- Current Supa milestone is **M3 ACTIVE**. Actual same-demand human 11-line PLUS baseline and 11-line DekaMarkt candidate observed within one shared 24-hour context [#78](https://github.com/Zennay/Supa/issues/78) remains missing. M4/M5 are **not eligible**.
- Corrected product source **[DRAFT #2180](https://github.com/Zennay/Supa/pull/2180)** at immutable head `df2046985bb6f8832e30d791fe9c0f4a32425816` is an independent owner fix for [issue #2173](https://github.com/Zennay/Supa/issues/2173). Its own CI #38492277394 was 761/761 PASS. That is **not** the unchanged external acceptance proof.
- Original independent **[QA #2174](https://github.com/Zennay/Supa/pull/2174)** exact head `815f884a23c8da1012ca8c6ac0bf9eef4341ac99`, on original source, initially proved 762 total / 756 passing / **six specific chronology failures** at [hosted CI #38488327020](https://github.com/Zennay/Supa/actions/runs/38488327020).
- This QA child branch adds exactly two **byte-for-byte copied original independent QA test files** (six one-source and three multi-source tests) and this separate documentation file, without editing the product owner, prior independent QA, current main, other worker paths, original workflows, retailer sources, permanent runner or any real capture.
- Original Git blob of `tests/qa-m5-capture-observation-chronology-20261014.test.mjs` is `d392c8e82f2b522819533834b47d1afb94e10e90`; original Git blob of `tests/qa-m5-mixed-source-chronology-20261014.test.mjs` is `103b626caa9cf18b7e6a26e819f66e5651d06048`. Compare these to the replay blobs on GitHub to prove **no weakened assertion**.

## Acceptance criteria
Nine true end-to-end offline CLI tests, all tiny fictional SHA-verified HTML under distinct private temp directories. Three legitimate private P2/P3 manual review cases remain positive; six formerly accepted invalid timestamp cases (future/equal reference, missing/invalid current, one invalid item among two valid sources) must now fail closed with generic stderr, zero output queue and untouched original fixtures. All selector, rights, production and M5 release flags remain false. Do not use real retailer requests, bypasses, credentials, private participant records or synthetic savings claims.

Run exact-head hosted CI; require `npm ci`, high npm audit, full `npm test`, M1 matching/source-permission gates and TS/Vite build to pass before calling this **technical fixed-source replay green**. Even a green hosted check cannot certify current-main integration, permanent VPS or M3 exit.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud SQLite preflight/write claim+lease, original product/QA owner review, current-main safe integration, relevant trusted permanent VPS, actual human M3 field observations and explicit release authorization.
