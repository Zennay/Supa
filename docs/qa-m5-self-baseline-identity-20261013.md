# Supa future-M5 self-baseline identity acceptance — 13 October 2026

## Scope
- Independent quality-only finding [#2170](https://github.com/Zennay/Supa/issues/2170).
- Frozen corrected product source owner [DRAFT #2162](https://github.com/Zennay/Supa/pull/2162), immutable `dd6e98b9b097ed21947fc4a4cdfaf8fc10d1aaab`.
- This branch adds the **original** synthetic four-case CLI test `tests/qa-m5-self-baseline-identity-20261013.test.mjs` and this policy document. It does not alter product, other QA, main, workflow or live data.

## Why the distinction matters
For future offline M5 comparisons, a `baselineProvided:true` result should refer to an independent prior capture directory, not merely the same current capture path passed as the second CLI argument. The M1 inspector SHA test authenticates content, not temporal independence. A self-compare can currently appear as `unchanged` priority P3 human review rather than a baseless comparison. Manual-only rights/selector/production safeguards remain false, and this is **not** an exploit or a retailer/savings claim.

## Frozen 4-case contract
1. Positive: one regular SHA-verified synthetic capture with no baseline is P2 manual baseline preparation.
2. Positive: two **different physical directories** containing identical invented HTML with separate capture timestamps may be P3 unchanged, remaining rights/selector/production/M5=false.
3. Expected RED: exact same root path supplied as both current and baseline must refuse with normal nonzero exit, empty stdout and generic stderr, never produce a false P3 review queue.
4. Expected RED: `join(current, '.')` lexical alias, resolving to exactly same physical root, must also refuse.

The original manifests, HTML data and SHA values must remain unchanged. Tests use only local temporary files and `example.invalid`, no retailer requests, actual user data, real prices, permissions or savings evidence. A source correction should compare resolved capture directory identities before scan, while retaining valid distinct-root same-content comparisons and safe input/error behavior. Symlink source containment [#2168](https://github.com/Zennay/Supa/issues/2168) and unbounded read limits [#2165](https://github.com/Zennay/Supa/issues/2165) remain separately owned.

**Expected first hosted result** on unfixed source: two positive GREEN plus precisely two intentionally failing source RED. This expected-failure suite is evidence of missing validation, **not a green full CI**. Replay identical QA after separately owned product fix with exact-head hosted + applicable permanent VPS.

**M3 actual gate:** human 11 PLUS + 11 DekaMarkt same-demand within 24 h [#78](https://github.com/Zennay/Supa/issues/78) OPEN; M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently verified zCloud SQLite scope/write claim/lease, original owners, current-main integration, permanent VPS where relevant and human releasego.
