# Independent M4 full causality regression replay — M3+M4 integration #2115

**Status: DRAFT / HOLD / NO MERGE / NO DEPLOY.** QA parent source is immutable commit `682dffbf5b02e00b880a6d40d1f599b6cedac111`, not a moving branch. The original unmodified QA controls cover both [#2107](https://github.com/Zennay/Supa/issues/2107) completed-week plan chronology and [#2110](https://github.com/Zennay/Supa/issues/2110) repair effort causality.

## Byte-identity and acceptance

1. Nine cases from original [DRAFT QA #2109](https://github.com/Zennay/Supa/pull/2109), original source Git blob `98dbdfd41d3a32de812261eb62702fe7bb9990a8`. Copied byte-for-byte to `tests/m4-lifecycle-owner-exact-replay-2107.test.mjs`; 3 positive controls and 6 formerly intentional RED on old main. Test exact `plan_started`, `plan_completed`, `beta_week_closed`, post-close activity, duplicate close and actual rejected CLI report.
2. Twelve cases from original [DRAFT QA #2112](https://github.com/Zennay/Supa/pull/2112), original source Git blob `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`. Copied byte-for-byte to `tests/m4-repair-owner-exact-replay-2110.test.mjs`; 7 positive controls and 5 formerly intentional RED on old main. Includes failed CLI output privacy, repeated/interleaved legitimate repairs, abandoned and unknown partial evidence.

**Required result: all 21 cases GREEN**, without suppressing tests, changing expectations or modifying source. An all-green outcome proves both independent QA suites agree with this exact *synthetic* product candidate. Additional `npm ci`, high audit, M1 matching benchmark, source-permission check and TypeScript/Vite production build must pass on the same exact QA head. Hosted green does not replace applicable permanent VPS checks, zCloud lease or owner release approval.

## Evidence gate

Supa remains **M3 ACTIVE**: a real same-demand 11+11 PLUS–DekaMarkt basket pair within 24 hours remains open [issue #78](https://github.com/Zennay/Supa/issues/78). Every M4 session in these tests is fictional. No real student recruitment, retailer requests, collection, live price evidence, public savings claims or M4/M5 eligibility is inferred. Other workers' source branches and original QA PRs must remain unchanged. This QA branch is **not a merge vehicle**; pending independent zCloud write preflight/claim/lease, product owner review, appropriate permanent VPS, current-main composition and explicit human release go.
