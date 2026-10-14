# Future M5 offline manifest provenance — strict UTF-8 bytes (2026-10-14)

**Product-core 1/2 / issue #2213**. Isolated child of frozen hosted-green #2210 SHA 9e2109e6e83ca1639245ebc167f22ed8e0a08906. No original owner, QA branch, main, workflow, VPS or source rights change.

## Problem and correction
The previously bounded manifest descriptor read used Buffer.toString('utf8'), which silently rewrites malformed original byte sequences to U+FFFD. A malformed byte inside a JSON string such as requestedUrl can become parseable after lossy replacement, so earlier successful HTML might be opened before malformed later input is rejected.
The correction decodes the already-bounded combined byte sequence with a fatal TextDecoder (UTF-8, ignoreBOM=true), preserving a formerly-invalid leading BOM for rejection by JSON.parse. Complete multibyte Unicode crossing a 64KiB descriptor-read boundary remains valid. Every raw current and historical manifest is preflighted before successful-source HTML inspection.

## Product-only synthetic acceptance
tests/product-m5-fatal-utf8-manifest-20261014.test.mjs exercises seven malformed UTF-8 byte forms in a later current row with earlier successful HTML deliberately absent; malformed historical input with current HTML absent; BOM refusal; valid Unicode split exactly at 65536-byte read boundary; valid P3 historical and P1 unavailable controls; a mock short-read descriptor with invalid bytes. CLI refusals preserve original manifests byte-for-byte, print generic private stderr, and emit no reviewer JSON.
All inputs are fictional local fixtures. No real retailer HTTP, customer data, source permissions, actual price savings or M4 participant recruitment.

## Limits / HOLD
This is manifest-decoding hardening only. It does not pin later M1 manifest/HTML rereads, prove atomic snapshots or prevent privileged filesystem races. Supa M3 ACTIVE, real same-demand 11 PLUS + 11 DekaMarkt within 24h #78 remains OPEN; M4/M5 ineligible.
**DRAFT/HOLD/NO MERGE/NO DEPLOY:** independent zCloud SQLite scope/task-write claim lease, original product/QA owner and independent QA review, exact hosted-green CI, safe latest-main and trusted permanent VPS/browser where applicable, actual M3 field observation and human releasego remain required.