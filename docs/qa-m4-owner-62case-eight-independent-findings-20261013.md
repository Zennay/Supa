# M4 exact frozen product owner — 62-case eight-issue independent QA acceptance

**Source:** original [product DRAFT #2114](https://github.com/Zennay/Supa/pull/2114), immutable code commit `f8fd8c9c184958f78c4db283eddd9fb0cedd6c40`; no changes to source or owner branches. QA frozen base: already verified six issue [DRAFT QA #2123](https://github.com/Zennay/Supa/pull/2123) exact `33357d1146cb3045c6e0a3c202d24d9bd078bdf4`, full [CI #38476061488](https://github.com/Zennay/Supa/actions/runs/38476061488) **753/753 PASS**.

This independent follow-up adds two other **byte-identical original** QA suites to the 41 cases already present:
- [#2109](https://github.com/Zennay/Supa/pull/2109) / issue [#2107](https://github.com/Zennay/Supa/issues/2107): 9 lifecycle/closure causal checks. New path `tests/qa-62-m4-lifecycle-original.test.mjs`; original identical blob `98dbdfd41d3a32de812261eb62702fe7bb9990a8`.
- [#2112](https://github.com/Zennay/Supa/pull/2112) / issue [#2110](https://github.com/Zennay/Supa/issues/2110): 12 valid and invalid repair pairing/CLI checks. New path `tests/qa-62-m4-repair-original.test.mjs`; identical original blob `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`.

Combined **62 M4 independent checks across eight issue contracts**: plan/closure lifecycle #2107, repair pairing #2110, safe integers #2049, basket uncertainty #2075, direct session IDs #2084, report/source alias #2086, malformed CLI output flags #2088 and strict private file mode #2091.

**Previous six-suite fixture compatibility is explicit**: [#2050](https://github.com/Zennay/Supa/pull/2050) original old numeric control had two orphan repairs (not accepted after #2110); only its two fixture scenarios were updated with prior `repair_started` events, numerical limits, overflow and privacy assertions unchanged. [#2089](https://github.com/Zennay/Supa/pull/2089) originally expected a less precise error string for empty `--output`; one assertion now checks exact stricter `requires a non-flag file path`, without changing failure/no-leak requirements. Four other original suites were byte-identically copied. Original independent owner PRs were **never edited**. This combined run adds untouched original lifecycle and repair QA again, making sure compatibility changes do NOT bypass these requirements.

**Run exact-head full CI**, high npm audit, all tests, M1 matching benchmark, M1 source permissions gate and TS/Vite build. Retain red evidence instead of relaxing checks if anything fails. A passing suite does not prove zCloud lease, original owner acceptance, applicable permanent VPS, current-main integration or human release approval.

Genuine human PLUS+DekaMarkt 11+11 same-demand M3 field pair [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN; all test baskets and M4 sessions fabricated. M4/M5 not eligible; no collection, recruitment, retailer access, release, public savings or deployment. **DRAFT/HOLD/NO MERGE/NO DEPLOY**.
