# Independent M3 persisted-empty-week quality validation — 13 Oct 2026

## Scope, branches and existing ownership
- Original [issue #1051](https://github.com/Zennay/Supa/issues/1051): zero-day physically empty planner and shopping list must **not** imply a financially claimable store comparison.
- Source fix is already owned by [product DRAFT #1012](https://github.com/Zennay/Supa/pull/1012), frozen exact `9ec4b3c7b01c75ae61661e2923056d544aadd0b8`. This separate QA proposal is strictly **ADD-only**: one original cross-domain test and this provenance document. No edits to owner #1012, independent original [QA #1074](https://github.com/Zennay/Supa/pull/1074), workflows, main, other branches or production data.
- Newer [product DRAFT #2167](https://github.com/Zennay/Supa/pull/2167) `52561c598d0726d801641e984a54575673280c28` accidentally asserts `empty.comparison.claimable:true` / `outcome:same` / `savingsCents:0`, contradicting #1051. I notified #2167 and #1051 through GitHub review comments. We do not edit that active product worker branch.

## Independent fixed-source cross-component contract
The new `tests/qa-m3-persisted-empty-week-financial-claim-20261013.test.mjs` composes the actual canonical persisted planner serialize/parse, controlled M2 shopping basket, both M3 store baskets, full comparator and saved shopping checklist key/restore helpers. Synthetic existing repo fixture data only.

1. A persisted empty active week remains literally empty in all three physical baskets and preserves the stored preferences, while *financial comparison* is `unknown / claimable:false / delta:null / savings:null / lineDeltas:[]` with explicit no-demand reason.
2. Previously checked shopping items cannot attach to an emptied basket; a subsequent resumed two-day physical basket has a distinct key and nonempty items.
3. Reordered persisted two-day recipes still produce equal physical requirements in shopping, baseline and candidate. Legitimate nonempty comparison remains claimable; editing only budget must not change basket demand or financial comparison.

This is independent of old pure comparator tests on #1012; it connects actual planner persistence and checklist behavior so a future conflict-resolution cannot fix #1051 by accidentally reactivating days or reintroducing stale checked items.

## Evidence and release
Exact frozen source + hosted full `npm ci`, high `npm audit`, Node suite, M1 matching/source permission gate and TS/Vite build must pass before this is considered a technical acceptance. A future cross-branch main integration must reconcile #2167 wrong positive expectation with #1012 source correction and replay original QA on the integrated head.

**Supa still M3 ACTIVE**, genuine human same-demand PLUS + DekaMarkt 11+11 within 24 h [#78](https://github.com/Zennay/Supa/issues/78) OPEN. No real observed prices, rights, published savings, M4 beta, M5 rollout or deployment. **DRAFT/HOLD/NO MERGE/NO DEPLOY** without independent zCloud SQLite scope/preflight/write lease, original owners, applicable permanent VPS/current-main validation and explicit human release authorization.
