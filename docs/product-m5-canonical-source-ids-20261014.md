# M5 future offline reviewer — canonical source ID admission (14 October 2026)

**Owner lane:** product-core 1/2. **Issue:** #2209. **Source parent:** frozen product DRAFT #2207 at `a617f502c6ab282cd2e6171504a425c5cfef4070`. This isolated child does not change predecessor, independent QA, main, workflows, deployed VPS or human field data.

## Difference

Before, raw M1 manifest source IDs were checked against an ASCII path-shaped regex but without a maximum length. An overlong later ID could pass manifest-level preflight and reach filesystem work (or OS filename errors) after earlier successfully captured HTML had been opened. The separately exported `captureShape()` trusted every string ID regardless of content/size and `compareInspections()` could echo forged Unicode, control-bearing or huge source IDs in the private reviewer JSON.

Now **both** raw manifest admission (current and historical, including unavailable/P1) and exported in-memory `captureShape()` require **1–128 ASCII chars**: first `[A-Za-z0-9]`, then `[A-Za-z0-9._-]`. This is a source identity validation rule, not HTML content verification. Source origin, SHA shape, all M1 actual-byte integrity verification, capture timestamp, distinct roots and resource budgets remain as before.

## Controlled proof

`tests/product-m5-bounded-source-ids-20261014.test.mjs` exercises 10 synthetic test cases (no store HTTP and no real retail data): exact 128-character P1, in-memory invalid Unicode/control/path/empty/null/129-byte IDs, invalid historical direct comparator; real 128-character SHA-matching P2, unavailable P1 without source HTML or digest, legitimate independent P3, later oversized current P1 and success, malformed historical row with earlier current HTML deliberately absent, and non-ASCII P1. Negative CLI cases assert generic stderr, zero report JSON and preserved input manifest contents.

The separate pre-existing QA-worker's original tests are **not** modified. Independent QA on this exact child source and applicable trusted worker/browser evidence remain separate gates; source-owner tests alone do not meet them.

## Gate and limitations

- **Supa M3 ACTIVE.** Genuine human PLUS 11 + DekaMarkt 11 observations for identical weekly demand within 24 hours (#78) not supplied. No field savings, permitted live retailer ingestion, M4/M5 enrollment, release or deployment.
- This narrow contract does **not** harden M1 inspector's subsequent path-based HTML rereads, protect against concurrent privileged filesystem replacement, or establish a race-free snapshot. It cannot upgrade rights, selector readiness or prices.
- **DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud SQLite scope/task claim+lease, original QA/source-owner review, exact hosted CI, safe latest-main and trusted permanent VPS where applicable, human M3 field evidence and explicit release permission.
