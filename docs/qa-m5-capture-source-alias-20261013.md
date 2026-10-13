# Independent Supa future-M5 capture symlink provenance QA — 13 October 2026

## Scope and source freeze
- [Issue #2168](https://github.com/Zennay/Supa/issues/2168), separate from the *M5 private human research* ancestry [#2102](https://github.com/Zennay/Supa/issues/2102), M1 research audit [#1243](https://github.com/Zennay/Supa/issues/1243) and HTML resource budget [#2165](https://github.com/Zennay/Supa/issues/2165).
- Original product correction owner [DRAFT #2162](https://github.com/Zennay/Supa/pull/2162), exact source SHA `dd6e98b9b097ed21947fc4a4cdfaf8fc10d1aaab`.
- Independent QA-only tests `tests/qa-m5-capture-source-alias-20261013.test.mjs` (original 5-case SHA-bound HTML/store boundary) and `tests/qa-m5-manifest-and-root-alias-20261013.test.mjs` (separate 3-case manifest/root boundary); this document is a third **ADD-only** path. Original 5-case QA test stays unchanged after first exact-hosted expected-RED proof. No original product/QA/main/workflow changes.
- User-facing M3 **still ACTIVE**, actual [#78](https://github.com/Zennay/Supa/issues/78) PLUS+DekaMarkt 11+11 same-demand observed within a 24-hour comparable context still OPEN. No M4/M5 deployment, rights or data automation eligible.

## Threat model and reproducibility
The future-M5 operator CLI preflights the M1 JSON manifest and then M1 loads `<capture-dir>/<supermarket>/<source-id>.html` via `readFile`. SHA256 checks ensure the loaded bytes match the manifest, but cannot prove that the source is an ordinary file *inside the declared capture root*, because the path may be a symlink into a different local tree. The contents remain fictional and local in tests; this is not a confirmed malicious retailer capture or data leak.

The original five tests create only temporary synthetic HTML and a correct manifest SHA for each fixture:

1. **Positive** regular HTML -> P2 private human baseline preparation, no eligibility/rights/selector/production.
2. **Positive** `success:false` -> P1 unavailable, no HTML read and no rights/production.
3. **Expected RED** SHA-valid symbolic **HTML file itself** points outside the capture root -> must reject.
4. **Expected RED** SHA-valid **supermarket directory** symlink points outside the capture root -> must reject.
5. **Expected RED** normal current + synthetic **symlinked baseline supermarket** -> must reject before review publication.

The second separately added suite verifies one positive ordinary manifest/root and two additional expected-RED cases: a symlinked manifest file in an ordinary directory, and the entire named capture-root directory itself being a symlink to a complete external fixture. Together the two suites require **3 positive GREEN and 5 intentional RED** until the source correction.

All negative cases demand normal nonzero exit, empty stdout (no JSON review queue), generic stderr without source ID, URI, HTML marker or temporary path. Test checks local fixture manifests, external original source bytes and symlink identity remain unchanged. No source HTTP requests or credentials.

Do **not** weaken cryptographic capture integrity or reclassify a noncanonical source as P2/P3 to satisfy tests. The source owner should choose an appropriate path-containment and no-symlink policy with race-aware directory handling and current+baseline coverage. After correction rerun the **unaltered original QA test blob** and full exact-head CI. An initial test runner with exactly three *intended* RED tests is evidence for a distinct unfixed source invariant, **not a green pipeline**.

**Release gate: DRAFT/HOLD/NO MERGE/NO DEPLOY** without zCloud SQLite preflight/write claim+lease, owners, applicable permanent VPS/Firefox, current-main integration and actual human M3 evidence + explicit human go.
