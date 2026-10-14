# Supa independent M5 source ID QA — 14 October 2026

**Project gate:** M3 ACTIVE. Real same-demand PLUS 11 + DekaMarkt 11 within 24 hours in issue #78 remains unobserved; M4/M5 ineligible. This is *future M5 offline private reviewer* QA, not actual retailer provenance, rights, savings or beta proof.

**Frozen source:** product owner DRAFT #2210, exact `9e2109e6e83ca1639245ebc167f22ed8e0a08906` (itself built from #2207 `a617f502c6ab282cd2e6171504a425c5cfef4070`).

**Unchanged independent suite:** 16 Git blobs copied byte-for-byte from QA DRAFT #2211 frozen `6a6ab0d1482fc34875b1f6a25174f9e223da382d`. These represent 104 independent pre-existing trust cases (89 before the SHA round, plus 15 SHA tests). No old QA path touched.

**New suite:** one add-only independent file tests exact 1/128 ASCII boundaries for pure exported captureShape and real synthetic P1/P2/P3 CLI, an array of malformed IDs in the in-memory API (Unicode, bidi, control, surrogate, too long, null, leading unsafe punctuation, path), pure current and historical rejection before output, and too-long late current/baseline P1/success raw rows rejected before any earlier successful HTML can be read. Negative tests require *exact early manifest error*, generic private CLI stderr, no JSON, and unchanged input. No real stores, customer records, network access or price claims.

**Provenance assertion:** preserve 16 existing QA files by exact Git blob SHA; source and QA suites are separated by immutable parent and own draft commit. SHA grammar controls from #2211 still included. A later M1 inspector read is not proven race-free; this is only preflight/control-surface QA.

**HOLD:** DRAFT / NO MERGE / NO DEPLOY pending independently demonstrated zCloud SQLite task scope/lease, original product and QA owner consent, current-main trusted runtime/CI review, real human #78 and explicit release authorization.
