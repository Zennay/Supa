# SUPA quality-validation: independent frozen ten-suite M3/M4 acceptance

**QA reviewer source** is immutable combined product commit `682dffbf5b02e00b880a6d40d1f599b6cedac111`, [DRAFT product PR #2115](https://github.com/Zennay/Supa/pull/2115), whose original product owner remains untouched. QA review **base** is the already-verified 41-case [DRAFT QA #2121](https://github.com/Zennay/Supa/pull/2121) exact `cbafbf256aecaa8800cbdcb4babe08fa883c5639`, [hosted CI #38474720110](https://github.com/Zennay/Supa/actions/runs/38474720110), **779/779 PASS**.

## Combined ten original independent QA suites

Existing four original M3/M4 suites from QA #2121, unchanged:
- [#2094 / issue #2093](https://github.com/Zennay/Supa/pull/2094): **6** weekStart and 24-hour observed-week scenarios; blob `fa8742c710ba07dc5ef8ac94de246a57b462f9b9`.
- [#2096 / issue #2095](https://github.com/Zennay/Supa/pull/2096): **14** M3 private metadata identity protection scenarios; blob `800a4e48e3a1ce777906bfb9fcd842bbde600d6d`.
- [#2109 / issue #2107](https://github.com/Zennay/Supa/pull/2109): **9** completed-week lifecycle scenarios; blob `98dbdfd41d3a32de812261eb62702fe7bb9990a8`.
- [#2112 / issue #2110](https://github.com/Zennay/Supa/pull/2112): **12** repaired-effort causality scenarios; blob `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`.

Six extra **byte-identical original QA files**, added on a separately owned review branch, no assertions or source modified:
- [#2050 / issue #2049](https://github.com/Zennay/Supa/pull/2050) — **8** safe integer, cent budget and overflow cases; original test blob `935f8a602fc13e87f44d30bd89e49a3991977a74`; new test `tests/qa-82-m4-safe-integer-original.test.mjs`.
- [#2076 / issue #2075](https://github.com/Zennay/Supa/pull/2076) — **10** M4 basket certainty versus unresolved products; blob `cd2b5ad8da84b04152ee1ab71103720aad03ec68`; `tests/qa-82-m4-basket-certainty-original.test.mjs`.
- [#2085 / issue #2084](https://github.com/Zennay/Supa/pull/2085) — **9** private M4 session/cohort email metadata module+CLI scenarios; blob `af7978edbad46460c5a1262f869d7eaa139781be`; `tests/qa-82-m4-identity-original.test.mjs`.
- [#2087 / issue #2086](https://github.com/Zennay/Supa/pull/2087) — **4** exact source path, hardlink and symlink protection, actual CLI; blob `57be882632bae08e80573b8b07cf1f577658b9d2`; `tests/qa-82-m4-source-output-alias-original.test.mjs`.
- [#2089 / issue #2088](https://github.com/Zennay/Supa/pull/2089) — **6** malformed `--output` options, stdout privacy and valid CLI controls; blob `2dba243f10e19ba4dedf9dc0420b1e26ee0cd2c1`; `tests/qa-82-m4-output-flag-original.test.mjs`.
- [#2092 / issue #2091](https://github.com/Zennay/Supa/pull/2092) — **4** real CLI private file permissions / existing output target under umask; blob `fed04f05e8df817b8e3f2d5966cf9b29cf4d0030`; `tests/qa-82-m4-private-report-mode-original.test.mjs`.

**Acceptance goal: 82 unchanged original executable controls together GREEN.** Product owner candidate #2114/#2115 claims source fixes for the six extra issues but previous owner CI tested owner-authored fixtures, not these independently authored tests. The purpose of this matrix is to *verify*, not presume, that all 82 are satisfied simultaneously without hidden regression. Required GitHub Actions proof must be tied to the exact QA HEAD, with complete `npm ci`, high-audit, npm tests, M1 matching benchmark, source rights/permission gate, and TypeScript/Vite build. If failures arise, preserve them as evidence; never edit test assertions to turn RED green.

**Hard boundary**: Synthetic financial/retailer/student evidence ONLY. Genuine human same-demand 11+11 PLUS + DekaMarkt basket pair [M3 issue #78](https://github.com/Zennay/Supa/issues/78) remains OPEN; no real prices or saved buyer data, no beta recruitment, scraping, other retailer rights or public saving promise. M4 and M5 remain **ineligible**. This is **DRAFT/HOLD/NO MERGE/NO DEPLOY**; requires independent zCloud scope claim/write lease, original QA/product owner review, applicable permanent VPS, up-to-date main integration and explicit human release authorization. This evidence-only branch must not be merged as release vehicle.
