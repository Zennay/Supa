# Supa independent synthetic-browser ZIP provenance QA — 14 October 2026

## Ownership and purpose
**Supa M3 ACTIVE**: only a **real human** 11× PLUS + 11× DekaMarkt same-demand measurement in one 24h context [#78](https://github.com/Zennay/Supa/issues/78) can satisfy the outstanding M3 savings-evidence gate. M4/M5, retailer reuse, public savings and deployments remain ineligible.

The product-core browser worker [DRAFT #2167](https://github.com/Zennay/Supa/pull/2167) owns all existing App/Firefox/UI/provenance producers. Freeze original source **`c912818c02a60bbdf44a0b0951e2f166fd96784b`**, no checkout of moving product branch. This QA lane adds **three files only**: independent offline auditor CLI `scripts/qa-audit-browser-archive-20261014.mjs`, adversarial synthetic ZIP test `tests/qa-browser-archive-trust-20261014.test.mjs`, and this note. No original product, hosted browser workflow, self-hosted VPS, existing tests, main or parallel worker branches modified.

## Actual source-archive provenance inspected
- GitHub-hosted real Firefox run [#38490414616](https://github.com/Zennay/Supa/actions/runs/38490414616) at exact product SHA `c912818c02a60bbdf44a0b0951e2f166fd96784b`.
- Genuine [artifact #11861117602](https://github.com/Zennay/Supa/actions/runs/38490414616/artifacts/11861117602) downloaded through GitHub connector; size **426999 bytes**, synthetic-only `result.json` has 11 actual browser checkpoint labels, **7** screenshot attestations, source HEAD `c912...`, separate checkout `c796d8d387551055499d4e65e5f4774168050168`, run ID `38490414616`, flags `retailerDataObserved:false` and `realSavingsClaimEligible:false`. Seven archived PNG names and IHDR dimensions are 500×846. This does not validate any real retailer source, release, a different future PR head, or unapproved VPS work.
- Product currently hashes and labels screenshots at producer time. This independent QA complements that **by auditing the archived bytes**: a green producer job cannot substitute for proof that the actual downloaded ZIP contains matching screenshots, run/HEAD attestation and restrictive source flags.

## CLI and bounded safety constraints
For a **downloaded synthetic fixture-only ZIP** (not a real participant archive):
`node scripts/qa-audit-browser-archive-20261014.mjs evidence.zip --head <40hex PR head> --run <exact GitHub run id>`

- No network, GitHub token, retailer requests, full-file extraction, environment credentials or permanent VPS. Ubuntu `unzip -Z -1` and `unzip -p` read only exact allowlisted flat member names. ZIP max 12MiB, member count 2..16, manifest max 64KiB, individual PNG <=1MiB; duplicate/traversal/unknown filenames rejected before reading.
- Require every archived PNG occurs **exactly once** in manifest `screenshots[]` and `screenshotIntegrity[]`; verify PNG signature/IHDR, observed byte count, dimensions, full SHA-256 against the **actual unzipped screenshot bytes**. Require valid exact PR-head and workflow-run provenance, distinct recorded checkout SHA format, no duplicated browser checkpoint labels.
- Enforce `retailerDataObserved === false` and `realSavingsClaimEligible === false`. Successful output always states `humanFieldEvidence:false` and `releaseEligible:false`. A future proof with actual participants must **not** run through this synthetic-only auditor; it needs separate controlled, consented, private human evidence.
- Eight Node tests generate only tiny fictional archives locally (Python `zipfile` available on GitHub-hosted Ubuntu); cover valid fixture, changed PNG digest, forged SHA, wrong source head, forbidden source/release flags, missing PNG, duplicate member/path traversal/unlisted image and forged dimensions/byte length. A killed/timeout process does not count as safe rejection.
- End-to-end actual saved GitHub ZIP replay is a separate evidence requirement: run the CLI against exact artifact #11861117602 and record the verified JSON; do not claim actual artifact GREEN based solely on the generated fixture tests.

## Release remains blocked
No product behavior, prices, users or real evidence changed. Original owner #2167 remains DRAFT. Independent zCloud SQLite preflight/scope claim/lease, original product+QA approval, permanent trusted VPS where applicable, latest-main composition, **human issue #78** and explicit release authorization remain outstanding. **DRAFT/HOLD/NO MERGE/NO DEPLOY.**
