# QA 2/2 — direct M5 queue requires actual successful JSON-LD behind candidate status

**Issue:** [#2295](https://github.com/Zennay/Supa/issues/2295).  
**Frozen owner:** [product DRAFT #2289](https://github.com/Zennay/Supa/pull/2289), `0de2b03bc8ced33f88dfbadb57c59a920c45061a`.  
**Scope:** add-only independent 13-test isolated QA case; **no product edits**.

The upstream `captureShape()` now requires an own product observation and at least one successfully parsed JSON-LD record before it returns `candidate_observation`. However the separately exposed `buildOfflineSelectorReviewQueue(report)` only bounds `jsonLdParseErrors <= jsonLdCount` and accepts a provided candidate even where `jsonLdCount === jsonLdParseErrors`. Forged reports can therefore reach the manual-only reviewer without any M1 parse evidence. This is an independent direct-API trust-boundary gap, not a real source incident.

The QA suite generates canonical reports through real offline `inspectHtml` -> `compareInspections`, and mutates **only report summaries**, never source files. Five canonical controls must stay green (real parsed fake Product P2, same P3, empty abstain, malformed abstain and mixed parse). Eight expected original-source RED cases enforce refusal of zero/all-error candidate reports, relabeled abstain, unchanged current/historical, historical removed P1 and changed-HTML P1. Rejected errors must be generic and never include fake source or price labels; inputs immutable. All permissions, production, selectors and M5 release flags remain false in the positive controls.

**Interpretation:** expected original-source RED is the intended evidence; this draft must **not** be merged, enabled, deployed or mistaken for build readiness. Product-core must own any later fix in `scripts/m5-build-selector-review-queue.mjs` on a separate branch, then QA should replay **exact identical Git test bytes** on the corrected owner and require fully green hosted CI. Do not silently weaken the test, merge it to main while RED, or infer real savings/source rights from fictional tests.

Supa remains **M3 ACTIVE**. Real human same-demand PLUS 11 + DekaMarkt 11 within 24h [#78](https://github.com/Zennay/Supa/issues/78) still pending. Future M4/M5 are ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud SQLite write claim/lease, original owners and QA approval, exact-head latest-main/trusted CI where relevant, genuine evidence and explicit human releasego.
