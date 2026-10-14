# SUPA QA 2/2 — bounded descriptor streaming and raw source origin, 14 October 2026

## Scope and pin
Supa remains **M3 ACTIVE**, M1/M2 technical slice complete. Genuine human [PLUS baseline 11× and DekaMarkt candidate 11× same-demand within 24h #78](https://github.com/Zennay/Supa/issues/78) remains OPEN; M4/M5 ineligible and no real retailer rights, prices, participants, savings or deployment allowed.

Latest product source [DRAFT #2205](https://github.com/Zennay/Supa/pull/2205) frozen exact `28a8f1a7f6ac4961a3010da80bbeaa09c48dca54`, incorporating [#2202](https://github.com/Zennay/Supa/pull/2202) raw-origin check, [#2200](https://github.com/Zennay/Supa/pull/2200) descriptor-pinned nofollow manifest read and [#2198](https://github.com/Zennay/Supa/pull/2198) raw canonical IDs. This independent QA child adds only its own nine-case synthetic Node test suite and provenance doc; no edits to source, main, original QA/other workers, CI workflows, permanent VPS or retailer data.

## Independent nine-case acceptance
- Directly exercises **exported** bounded descriptor-read helper with fake deterministic FileHandle.read: Unicode UTF-8 bytes split across read chunks are preserved; exactly 8MiB accepted; a descriptor offering 64MiB after a simulated earlier stat of 128 bytes must stop after **8MiB+1** bytes, never requesting >64KiB at a time; empty descriptor returns empty string.
- Real local CLI/API source provenance: SHA-valid P2 current and real failed/P1 remain manual-only, no selector/rights/production/M5; **later invalid supermarket**, even with previous successful HTML intentionally absent, must fail as raw manifest error before HTML reads; invalid kind on later P1 row must fail; historical kind longer than 128 characters must fail before opening missing current HTML. Invalid cases require exact direct comparator error 'Invalid or oversized M1 capture manifest', normal CLI nonzero exit, empty stdout, generic private stderr and unchanged manifest bytes.
- All test data is invented local SHA-verified HTML or in-memory simulated descriptors; no HTTP, real retailer data or personally identifying data. A bounded preflight read does **not** imply descriptor-pinned later M1 inspector rereads/HTML reads, race-free filesystem trust or production approval.

Require exact HEAD GitHub-hosted npm ci/high dependency audit/full Node tests/M1 matching and source-permission gate/TS-Vite build to claim technical GREEN. Independent original-source RED counterpart can be composed on frozen pre-#2202 product owner without altering these tests.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud SQLite task/write scope preflight+claim lease, original product/QA owners, safe latest-main/current trusted VPS integration, human M3 field evidence and explicit human releasego.
