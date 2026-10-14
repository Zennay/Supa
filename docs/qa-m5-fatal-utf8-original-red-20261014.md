# Original M5 UTF-8 byte admission — expected-source RED, 14 October 2026

- Frozen *uncorrected* product #2210 SHA `9e2109e6e83ca1639245ebc167f22ed8e0a08906`, before product #2216's fatal UTF-8 decoder.
- **Same immutable independent test blob** `79e2c659bc75b7ec284b98b1a2cf10a06a8c2892` as QA #2218 on corrected SHA `aaa28d1b6ee89f661ab76e16b45b062d78b862d9`.
- Anticipated original-source RED: malformed raw UTF-8 in unused JSON metadata is replacement-decoded rather than rejected in manifest preflight, so earlier missing HTML is accessed; mock descriptor invalid surrogate decodes lossy instead of throwing. Good P1/P2/P3 Unicode controls and BOM existing failure must continue to pass. Synthetic-only, no real retailers, network or customers.
- Full exact-head CI will distinguish expected targeted failures from unrelated failures. Keep **DRAFT/HOLD/NO MERGE/NO DEPLOY**, M3 actual human field #78 11+11 within 24h missing, M4/M5 ineligible, zCloud scope/lease/owner approval absent.
