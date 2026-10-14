# Supa independent QA: historical capture limits, original-source witness (EXPECTED RED)

- Scope: quality-validation 2/2, issue #2241, frozen owner product DRAFT #2240 `1e50d05c1df369c6691c1c5d55c034e2fc7c5f66`.
- Independent, only ADD test: `tests/qa-m5-historical-cohort-provenance-20261014.test.mjs`, 15 synthetic cases.
- Expected original-source failures: 101 historical captures within a valid 200-action cohort, 200 historical captures despite `captureCount=0`, and an `unavailable` P1 action claiming `baselineProvided=false` despite attached historical snapshot. Nothing should silently be normalized into approval.
- Controls: 100 historical-only; exactly 100 current + 100 disjoint historical; real P1 without baseline; real P2; true unchanged P3; privacy-safe tokens, immutability, deterministic ordering and all release/rights flags false.
- This PR is deliberately held and **must not be merged or deployed**. Record hosted CI exact-head RED only as expected original-source witness; test against corrected product DRAFT #2243 independently in a separate branch.
- Supa M3 ACTIVE; issue #78 demands a *human-observed* same-demand 11 PLUS + 11 DekaMarkt basket pair within 24h before real-world claims. No retailer/user/price/network data were used. This test is not field evidence and does not make M5 eligible.
- Missing independent zCloud SQLite scope/task write lease and full original owner/reviewer/release authorization keep it DRAFT/HOLD.
