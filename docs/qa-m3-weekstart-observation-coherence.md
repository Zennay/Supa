# QA — M3 weekStart/observation coherence (synthetic only)

- Scope: `src/domain/observedBasketStudy.ts` **unchanged**, separate quality-validation branch based on immutable `main=c36f5c8f71d77cae94663978b51a194e9b183af6`.
- Tracker: [#2093](https://github.com/Zennay/Supa/issues/2093). Human real-world field proof [#78](https://github.com/Zennay/Supa/issues/78) is still OPEN.
- CLI/test: `node --test tests/qa-m3-weekstart-observation-coherence-red.test.mjs`. Uses only the canonical synthetic M2 planner/product fixture with 11/11 matched lines in each basket. There is no retailer request, scraping, personal data or actual savings claim.

## Acceptance matrix

| Case | Week starting | Both basket observations | Desired behavior at source repair |
|---|---|---|---|
| Legitimate same-week control (GREEN) | 2026-09-28 | 2026-10-02 17:00Z / 18:15Z | Comparable synthetic full basket, 1.25h apart, outcome better, **not public evidence** |
| Historical mislabel (EXPECTED RED) | 2025-09-29 | **same** 2026-10-02 timestamps | `claimable=false`, `outcome=unknown`, `deltaCents=null`, `savingsCents=null` |
| Future mislabel (EXPECTED RED) | 2027-09-27 | **same** 2026-10-02 timestamps | Same fail-closed outcomes |

Both RED cases keep demand, prices, stores, sources, field identity and 24h gap *identical* to the positive control. Thus they isolate only the missing `weekStart` relationship; do not mistake the 24-hour inter-store bound for a study-week coherence check.

## Design handoff to source owner

Implement a single, documented allowable shopping/observation window for the nominated planning week. Do not assume shopping always occurs Monday; consider a short pre-week shopping allowance and timezone-aware local calendar dates, especially near Sunday/Monday and daylight-saving transitions. A max-age policy alone is not sufficient: the observation must correspond to the **declared** planning week. Reject mismatched weeks at domain assessment with an explicit reason, preserve the raw research artifacts, and never render a non-corresponding technical comparison as savings evidence. Keep existing M3 privacy and source-permission checks.

This independent expected-RED reproduction is not the source fix. Coordinate with original domain owners, independent zCloud lease/preflight, corrected exact-head hosted CI, applicable permanent VPS regression, latest-main composition and explicit human release go. **DRAFT / HOLD / NO MERGE / NO DEPLOY.** No participant beta or M4 release authorization.
