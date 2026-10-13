# SUPA product-core M3/M4: isolated cross-fix integration evidence

This branch composes **only our three separate product-core draft candidates**, to verify that their corrected source files and synthetic tests coexist on the same unchanged canonical `main=c36f5c8f71d77cae94663978b51a194e9b183af6` base.

## Contents
- [DRAFT #2111](https://github.com/Zennay/Supa/pull/2111): reject email-like direct identifiers in derived M3 report metadata (issue #2095).
- [DRAFT #2113](https://github.com/Zennay/Supa/pull/2113): observed PLUS/DekaMarkt basket dates must match declared planning week (issue #2093).
- [DRAFT #2114](https://github.com/Zennay/Supa/pull/2114): M4 completed-plan / closure chronology and repair start/completion pairing (issues #2107, #2110).

All three source fixes address synthetic source-derived risks, not real participant or retailer incidents. **No** independent QA PR source, other worker-owned file, frozen QA test or other user project has been modified. The combined branch is for hosted automated build/test proof and **not** a release, deployment, substitute for independent QA, or request to merge. Final green CI (if observed) applies to this exact branch SHA only.

## Non-negotiable gate
Actual project milestone remains **M3**. Real same-demand 11+11 PLUS/DekaMarkt field pair [#78](https://github.com/Zennay/Supa/issues/78) is still outstanding. There is no real M4 beta, M5 production ingest, retailer authorization or public savings proof. The M4 `m3Gate=closed` fixture is wholly fictional. **DRAFT/HOLD/NO MERGE/NO DEPLOY** until zCloud independent lease/claim/preflight, original owners, independent corrected-source QA replay, latest-main composition, applicable permanent VPS/Firefox, explicit human release approval.

The original three PRs remain separate to preserve ownership and review granularity; do not cherry-pick this evidence-only branch onto `main` without a deliberate coordinated integration review.
