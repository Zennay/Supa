# M3 field discrepancy triage and replay protocol

Status: **operator/reviewer protocol, not observed evidence**. Applies to the genuine same-demand PLUS vs DekaMarkt basket required by [issue #78](https://github.com/Zennay/Supa/issues/78). Do not mark M3 complete from this document.

## Before interpreting any difference

1. Pin the exact Git revision, canonical frozen 11-line demand snapshot, selected store/region and both original observation files. Preserve the original raw files without reformatting or overwriting.
2. Confirm each observation has its own source URL or in-store location, captured-at timestamp, acquisition method, price context (online/in-store, loyalty eligibility), and identifiable product/pack description. Require a common context and captures within 24 hours.
3. Run the repository's canonical observation converter and assessment commands documented in the current README; record exact commands, exit status, stdout/stderr and output digests. Never hand-edit a failed output to make it pass.
4. Review each demand line **before** reading the calculated winner. Missing prices, unavailable products, incomparable units, unsupported offer conditions or unclear substitutions are explicitly unresolved, never zero-cost purchases.
5. Independently recompute each purchasable line as the actual number of whole packs required multiplied by the applicable observed pack price (including only provably eligible offers), then sum in integer cents. Record mismatches without replacing source evidence.

## Decision taxonomy

| Code | Observation | Decision | Required next step |
| --- | --- | --- | --- |
| D01 | Different frozen demand or ingredient quantity | **Reject comparison** | Recollect both stores against one unchanged demand identifier. |
| D02 | Capture interval exceeds 24h or contexts conflict | **Reject comparison** | Recollect within the window and same price context. |
| D03 | Missing source, timestamp, store scope or product identity | **Unknown / not claimable** | Capture verifiable provenance; do not infer. |
| D04 | Out-of-stock product or missing quote | **Unknown / incomplete basket** | Preserve unavailable outcome; obtain valid fresh observations if possible. |
| D05 | Different pack size requiring different whole-pack counts | **Recalculate** | Show both pack counts, leftover quantity and costs; retain pack-size attribution. |
| D06 | Promotion requires card, coupon, minimum units or uncertain eligibility | **Unknown unless verified** | Record offer mechanics and eligibility; otherwise use an independently verified non-offer price or keep unknown. |
| D07 | Candidate product is not a defensible ingredient match | **Reject line match** | Document ingredient identity and substitution decision; do not silently substitute. |
| D08 | Decimal/rounding discrepancy | **Reconcile** | Calculate in integer cents and record exact line-by-line and basket delta. |
| D09 | Store basket is more expensive or equal | **Valid negative/neutral outcome if complete** | Report worse/same faithfully; do not cherry-pick cheaper lines. |
| D10 | Parser/normalizer behavior differs from raw observed evidence | **Investigate software defect** | Preserve minimal sanitized reproduction, commit hash and test; do not edit observation to fit parser. |
| D11 | Duplicate line, omitted requirement or extra product | **Reject incomplete comparison** | Reconcile against frozen demand, not against the computed total. |
| D12 | Location-dependent price, shipping, deposit or fee unclear | **Unknown until scope resolved** | Record inclusion/exclusion rules symmetrically before computing a winner. |

## Reviewer record (copy per real observation pair)

- Frozen demand identifier and SHA-256:
- Source observation locations, capture timestamps and local timezones:
- Store/region and common pricing context:
- Original evidence paths and SHA-256 digests:
- Pinned Git revision and converter/assessor command outputs:
- Per-line discrepancies (D-code, source quote, counted packs, integer-cent cost, proposed disposition):
- Unresolved/missing demand lines per store:
- Total costs and delta **only if both baskets complete and comparable**:
- Savings attribution (price vs pack size vs offer; planning must be zero for identical demand):
- Reviewer decision: **pass / unknown / reject**:
- Negative outcome or limitation recorded verbatim:
- Reviewer and review timestamp:

## Non-negotiable claim boundary

A negative, equal, incomplete or unknown result is useful study evidence. Only a fully attributable, reproducible same-demand basket pair with verified coverage and context may support a *specific observed* basket difference. It does not establish population-level or future savings. Do not synthesize retailer prices, promote fixture outputs to field evidence, collect personal loyalty identifiers or circumvent a retailer's access restrictions. Keep #78 open until actual observations pass the canonical gate.
