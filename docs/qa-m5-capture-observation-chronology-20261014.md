# Supa independent M5 capture-observation chronology QA — 14 October 2026

## Scope and owner separation
- Current Supa milestone remains **M3 ACTIVE**. Only authentic same-demand PLUS 11 lines + DekaMarkt 11 lines within one comparable 24-hour human-observed price context can satisfy [field issue #78](https://github.com/Zennay/Supa/issues/78). M4/M5 future operations are **ineligible**.
- This **QA-only ADD** validates the future M5 offline snapshot comparison, freezing original corrected product owner [DRAFT PR #2162](https://github.com/Zennay/Supa/pull/2162) at `dd6e98b9b097ed21947fc4a4cdfaf8fc10d1aaab`.
- [Issue #2173](https://github.com/Zennay/Supa/issues/2173) concerns **temporal provenance** and does not duplicate same-directory identity [#2170](https://github.com/Zennay/Supa/issues/2170), local symlink containment [#2168](https://github.com/Zennay/Supa/issues/2168) or oversized local capture bytes [#2165](https://github.com/Zennay/Supa/issues/2165).
- Exactly two new QA paths: the original six-case Node real-CLI test and this document. No product source/active owner files, old QA, main, workflows or live captures changed.

## Reproducible original six-case contract
1. A canonical SHA-verified current snapshot with valid RFC3339 timestamp and no baseline stays P2 manual preparation.
2. Two *different genuine regular local capture directories* with identical synthetic HTML, a strictly older baseline and newer current timestamp, remain P3 unchanged/manual-only.
3. **Intended RED:** baseline observation with time **after** current observation must not be accepted as a historical reference, even if SHA and HTML shapes match.
4. **Intended RED:** equal UTC instant with different timezone offsets is **not strictly older**, despite the different timestamp strings.
5. **Intended RED:** missing raw `capturedAt` must not silently become a verified P2/P3 source.
6. **Intended RED:** impossible raw `capturedAt` calendar value must not silently become a verified P2/P3 source.

The tests write only tiny fictional local HTML with real SHA-256 matching each M1 manifest. No network, retailer requests, user/participant details, real prices, rights or public savings. Every failure must be normal nonzero process exit, empty JSON stdout, generic non-leaking stderr and intact original fixture bytes. No timeout, killed process or malformed SHA can count as successful rejection. Positive cases explicitly keep reviewer action only, rights/selector/M5/production disabled.

On frozen unfixed source, exact hosted CI is expected to show **2 valid positives GREEN + exactly 4 original-source RED**. A deliberately red source-behavior test is *not* full CI GREEN. Separate product owner to select safe canonical timestamp and per-source chronology validation before parsing/comparison; do not degrade existing unavailable P1 or remove crypto-verification. Replay original unchanged QA after source correction and require full independently hosted, current-main and applicable permanent VPS evidence.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.** Original source/QA owners, independent zCloud SQLite task preflight/write claim+lease, applicable VPS/current-main integration, authentic human field #78 and explicit release authorization remain gates.
