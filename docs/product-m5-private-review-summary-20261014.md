# SUPA future offline M5 — private human review workload summary (14 October 2026)

**Status:** future M5 research-only, **DRAFT/HOLD/NO MERGE/NO DEPLOY**. SUPA remains **M3 ACTIVE** until authentic human same-demand [11-line PLUS and 11-line DekaMarkt observation #78](https://github.com/Zennay/Supa/issues/78) is collected within 24 hours in one price context. A review summary never creates verified selectors, legal source reuse, real prices, savings evidence, beta eligibility or production permission.

## Operator problem and product improvement
The existing offline human-only selector review emits up to 200 sorted, anonymized P1/P2/P3 review actions. A reviewer previously needed to scan all rows or author extra code to know how many human interventions were high-priority (P1) versus planned P2 and lower-priority P3. The new `summary` is an aggregate derived **only from successfully validated output actions**:

- `actionCount`: total bounded actions in the queue.
- `priorityCounts`: always includes integers `P1`, `P2`, `P3` even at zero.
- `statusCounts`: always includes all eight canonical review statuses, including zeros for absent categories.
- Counts are deterministic under input reordering, with both priority and status totals summing to `actionCount`. No source strings, prices, URLs, DOM content, source paths or other private data are put in the summary.
- An entirely empty physical review queue produces explicit zero totals. All previous per-action `selectorVerified=false`, `rightsVerified=false`, `productionEnabled=false`, and report-level `productionReady=false`, `m5Eligible=false` remain unchanged.

## Scope and test method
New isolated product-core child of frozen original [DRAFT #2258](https://github.com/Zennay/Supa/pull/2258) exact hosted-green SHA `9335cd8df967dd71a1d9b0b202d4de5e0083e806`, [issue #2262](https://github.com/Zennay/Supa/issues/2262). Changes only one existing pure M5 queue module, one new eight-case synthetic product acceptance test file, and this own document. All existing product/QA owners and branches, M1/M3/Planner/UI, main, CI workflows, VPS, users and retailer captures remain untouched.

Tests exercise all eight status categories via physically possible baseline and no-baseline cohorts, mixed P1/P2/P3, empty review, sorted/action-order invariance, true 100-current + 100-historical union, untrusted input `summary` injection ignored, malformed reports rejected and canonical `inspectHtml` -> SHA-256 -> M5 comparison -> private queue P3 integration. Run full exact-head GitHub-hosted Node tests, `npm audit --audit-level=high`, M1 matching and permission gates and TypeScript/Vite build before claiming success.

**Release gates still held:** independently verified zCloud SQLite write claim/lease, original product and QA owner approval, latest-main and applicable trusted runner evidence, genuine M3 human #78 and explicit human release authorization. This is purely offline reviewer convenience, not activation of M5.
