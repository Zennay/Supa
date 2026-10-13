# Independent fixed-source M5 raw M1 manifest-success replay (13 October 2026)

**Milestone M3 ACTIVE**, authentic same-demand 11 PLUS + 11 DekaMarkt basket observations [#78](https://github.com/Zennay/Supa/issues/78) human-open. This is future-M5 offline-only synthetic assurance; no store API, price, rights, users, automatic selectors, savings claim or release.

New isolated product-owner [DRAFT #2162](https://github.com/Zennay/Supa/pull/2162) exact immutable SHA `21c6a58d7da514b3fca15ec6bed9eb182cb66732` (M5-only raw manifest preflight rejects nonboolean `results[].success` before existing M1 inspector coerce/HTML read). Original M1 inspector, product owner branch/tests, other worker QA, main, workflows and VPS untouched.

Own frozen QA base `qa/frozen-m5-raw-success-fixed-21c6a58d-20261013` and independent QA-only `qa/m5-raw-success-six-postrepair-20261013`. Exactly two NEW QA-only paths: one test and this document. Six original real CLI assertions **byte-identical** to *corrected helper* original [DRAFT QA #2161](https://github.com/Zennay/Supa/pull/2161), exact Git blob `91aeba663302d6559b61ba019721251525a6e6e9`, no assertion changed. Note the earlier initial QA helper blob `e7b577f03590d93ccc11da4c7119f65b6ac3d73d` had a local shadowing bug (`const URL`) and is **NOT** valid RED evidence; exact corrected original proof [CI #38482610891](https://github.com/Zennay/Supa/actions/runs/38482610891) **746 total/742 PASS/exact four intentional RED/0 skips**, two canonical positive real CLI checks PASS. Owner PR #2162 copied actual corrected helper Git blob, despite older original SHA mentioned in its prose.

Acceptance: canonical raw true/false cases remain P2/P1 with no private source output and rights/production false. All four groups of raw string true/false, numeric/string-numeric, null/absent must now **fail closed with generic diagnostic and zero JSON output**; the original six exact test assertions must be **6/6 GREEN** due to source fix only.

Run exact new SHA hosted full npm ci/audit, all Node tests, M1 matching/source permission gate and TS/Vite build; report PASS only after observed CI. Not current-main/permanent VPS/independent zCloud write preflight/lease, owner review, M3 human field or human releasego.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.**
