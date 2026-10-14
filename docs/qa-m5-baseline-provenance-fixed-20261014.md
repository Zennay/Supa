# Supa independent QA: historical capture limits on corrected owner (HOLD)

- Scope: quality-validation 2/2, GitHub issue #2241 and frozen corrected product DRAFT #2243 `2ad763d96c4f276a138efcece08b96a872026004`.
- Independent QA only; same byte-identical `tests/qa-m5-historical-cohort-provenance-20261014.test.mjs` as separate original-source RED witness; 15 fully synthetic pure in-memory cases, no production code changed.
- Assert physical M1 historical maximum **100** independently of `captureCount` and action union maximum 200; refuse historical verified **and** unavailable metadata under `baselineProvided=false`, even for P1 unavailable; keep valid 100+100 disjoint union, genuine P1/P2/P3, deterministic anonymized tokens, immutability and every production/release flag false.
- Run hosted GitHub CI at **this exact QA head**; do not infer GREEN from corrected product tests or prior QA suites. If it is GREEN, it only proves synthetic future offline private M5 inputs, not live retailer rights or actual savings.
- Supa remains M3 ACTIVE with genuine human same-demand PLUS 11 + DekaMarkt 11 within 24h issue #78 OPEN; M4/M5 NOT eligible.
- **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independently verified zCloud SQLite task-write claim/lease, owner review, latest-main/integration/trusted VPS where needed, human field proof and explicit human release approval. No changed original product/other QA/worker/main/workflows/permanent VPS paths.
