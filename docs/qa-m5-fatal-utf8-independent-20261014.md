# Independent Supa future M5 fatal UTF-8 QA — 14 October 2026

**Release reality:** Supa M3 ACTIVE, genuine human #78 11 PLUS + 11 DekaMarkt same-demand within 24 hours still pending. M4/M5 not eligible, no retailer permissions or savings.

**Frozen owner:** product-core DRAFT #2216 SHA `aaa28d1b6ee89f661ab76e16b45b062d78b862d9`, parent original DRAFT #2210 `9e2109e6e83ca1639245ebc167f22ed8e0a08906`. Existing 17 independent test Git blobs (126 cases: earlier 104 preserved + 22 source-ID controls) copied exactly from QA #2214 SHA `b12361c2d465c401652214ee1513f1e363d80274`. This suite adds only independent tests and own document.

**New independent controls:** malformed raw bytes inside **unused P1 metadata** and late successful metadata (not only URL), in current and historical manifests, must fail with exact preflight-manifest error before deliberately missing earlier valid successful HTML. Includes incomplete four-byte UTF-8, surrogate, overlong NUL, out-of-range codepoint, stray continuation, 0xff/0xfe, BOM retained rejection; generic CLI, no reviewer JSON and byte-identical input after rejection. Valid literal Unicode U+FFFD P1 and emoji/accents on P2/P3 remain private/manual, split four-byte Unicode descriptor chunks round-trip and low-level invalid descriptor bytes throw TypeError. No synthetic HTML should be misconstrued as real retailer field evidence.

**HOLD:** Exact-head hosted CI, original owner and independent zCloud SQLite task claim/lease, safe latest-main and trusted permanent runtime, genuine human #78 and explicit releasego before merge/deploy. This does NOT prove atomic rereads of manifest/HTML by the M1 inspector.
