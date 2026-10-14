# M5 future work: verified M1 snapshot-shape comparison

**Status:** offline research tooling only. SUPA's actual milestone remains **M3**. This is an isolated P1 preparation slice for Notion PWQ-317 / epic #2069, **not** a production supermarket adapter or permission to start M5.

## Run

Use existing, **locally provided** M1 capture directories, containing a bounded `manifest.json` and matching retailer HTML captured and approved separately:

```bash
node --experimental-strip-types scripts/m5-compare-capture-signatures.mjs artifacts/m1-captures/new
node --experimental-strip-types scripts/m5-compare-capture-signatures.mjs artifacts/m1-captures/new artifacts/m1-captures/old
```

The tool invokes the existing `inspectCaptureDirectory` from `scripts/m1-inspect-captures.mjs` for each directory: it verifies M1 metadata and exact SHA-256 before processing any extraction signature. **It performs no network request, creates no HTML snapshot or output file, sends no credentials, and never authorizes a retailer.** Synthetic unit tests exercise the contract without contacting live supermarkets.

The JSON report contains only source-safe IDs, provider/kind metadata, integrity-linked content hashes, a known-field JSON-LD signature hash, high-level script signals and a conservative parser outcome. It deliberately omits product titles, prices, URLs and embedded JSON payloads. Reports are for local review, not public price claims.

## Drift statuses

- `baseline_missing`: previous capture absent; never treat as proof of stability.
- `added` / `removed`: previously unseen or missing source.
- `unavailable`: one of the capture runs failed; **unknown**, never zero or unchanged.
- `shape_changed`: recognized JSON-LD top-level keys, types or script signals changed, or schema.org Product parsing changed from observation to abstain.
- `content_changed_shape_stable`: actual SHA changed but recognized high-level signals were unchanged. This does **not** prove selectors, prices or offers still extract.
- `unchanged`: identical verified snapshot and high-level signals.

This is a **first-stage discovery triage**, not a CSS-selector engine: detecting nested offers, arbitrary DOM selectors, `__NEXT_DATA__` field paths, promotion structures and retailer-specific state requires licensed real HTML fixtures, source-owner approval, a properly bounded parser and independent extraction regression tests. Do not infer these capabilities from these signatures.

## Boundaries / acceptance

- 100 maximum source entries per report; duplicate source IDs fail closed.
- Failed captures produce `unavailable`, not valid observations.
- Hash disagreement, incomplete manifest or non-verified captures throw; no untrusted signature is output.
- All `productionReady` and `m5Eligible` values are always **false**.
- Existing PLUS/DekaMarkt M1 permission gate, M3 genuine two-store observed basket #78, permanent VPS and human releases are not changed.
- This module **does not claim to protect against on-disk race/symlink changes** in the existing M1 inspector. Keep private captures on a trusted, owner-controlled filesystem and do not expose or process untrusted arbitrary paths until the separate M1 hardening contracts are met.

**Next PWQ-317 piece after authorized sample capture:** review real samples offline; version checked embedded JSON paths and store-specific DOM extraction tests. Stop on 403/429 or source refusal; never use evasion/proxy bypass.
