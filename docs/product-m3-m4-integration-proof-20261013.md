# SUPA product-core M3/M4: isolated cross-fix integration evidence

This branch composes **only our three separate product-core draft candidates**, to verify that their corrected source files and synthetic tests coexist on the same unchanged canonical `main=c36f5c8f71d77cae94663978b51a194e9b183af6` base.

## Contents
- [DRAFT #2111](https://github.com/Zennay/Supa/pull/2111): reject email-like direct identifiers in derived M3 report metadata (issue #2095).
- [DRAFT #2113](https://github.com/Zennay/Supa/pull/2113): observed PLUS/DekaMarkt basket dates must match declared planning week (issue #2093).
- [DRAFT #2114](https://github.com/Zennay/Supa/pull/2114): M4 completed-plan / closure chronology and repair start/completion pairing (issues #2107, #2110).

## Second product-core integration iteration (13 October 2026)
- The existing M4 product owner's [DRAFT #2114](https://github.com/Zennay/Supa/pull/2114) was extended (exact owner SHA `f8fd8c9c184958f78c4db283eddd9fb0cedd6c40`) to correct **three private report publication gaps** [#2086](https://github.com/Zennay/Supa/issues/2086), [#2088](https://github.com/Zennay/Supa/issues/2088), [#2091](https://github.com/Zennay/Supa/issues/2091), and **three evidence trust gaps** [#2084](https://github.com/Zennay/Supa/issues/2084), [#2075](https://github.com/Zennay/Supa/issues/2075), [#2049](https://github.com/Zennay/Supa/issues/2049).
- Two new synthetic source/actual-CLI test suites and two detailed documents accompany the one updated M4 source blob. This combined branch now holds all eight M4 findings and both M3 corrections; it remains **integration evidence only, not a merge vehicle**.
- [Exact hosted owner CI #38473849275](https://github.com/Zennay/Supa/actions/runs/38473849275) on `f8fd8c9...`: **712/712 PASS, zero failures/skips; npm high audit, permission gate, matching benchmark and build PASS**. Its owner CI is NOT automatically an exact combined branch certification. This integration branch needs its own fresh exact-head run after this composition change; older [integrated CI #38472845414](https://github.com/Zennay/Supa/actions/runs/38472845414) **708/708 PASS** applies only to former head `8b90f398...`.
- Permanent runner validation remains independent and not assumed green. No original independent QA branches were modified or merged; their frozen tests should be replayed by their owners.

All three source fixes address synthetic source-derived risks, not real participant or retailer incidents. **No** independent QA PR source, other worker-owned file, frozen QA test or other user project has been modified. The combined branch is for hosted automated build/test proof and **not** a release, deployment, substitute for independent QA, or request to merge. Final green CI (if observed) applies to this exact branch SHA only.

## Non-negotiable gate
Actual project milestone remains **M3**. Real same-demand 11+11 PLUS/DekaMarkt field pair [#78](https://github.com/Zennay/Supa/issues/78) is still outstanding. There is no real M4 beta, M5 production ingest, retailer authorization or public savings proof. The M4 `m3Gate=closed` fixture is wholly fictional. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until zCloud independent lease/claim/preflight, original owners, independent corrected-source QA replay, latest-main composition, applicable permanent VPS/Firefox, explicit human release approval.

The original three PRs remain separate to preserve ownership and review granularity; do not cherry-pick this evidence-only branch onto `main` without a deliberate coordinated integration review.
