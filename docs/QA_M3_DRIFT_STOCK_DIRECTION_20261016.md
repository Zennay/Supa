# QA: historical stock-direction drift — 16 October 2026

## Scope and ownership
Independent `quality-validation (2/2)` differential tests for the **already merged** offline M3 source drift engine, replayed on merged `main` `cac55435ddb772288bddcd3aac5ede094d8ca49c` (includes product input guard #3122). One new QA-only test file and this guide. No change to product-owned scripts, other workers' QA, shared workflows, fixtures, source permission registry, or main.

## Acceptance questions
The operator's two SHA-reviewed historical archives must distinguish *worsening* stock uncertainty from *improving* historical metadata. The current baseline only checks one changed availability marker and general fact alerts. These eight reproducible cases isolate stock direction and source partitioning:
1. Available → unknown: exact unknown-stock increase, one plus:product signal only.
2. Available → unavailable: exact historical unavailable increase, without a false unknown signal.
3. Unavailable → available: negative stock-out delta, no new-stock-out alert; still historical-only and manual fact review.
4. Unknown → unavailable: alert for stock-out, never a fabricated rise in unknown inventory.
5. 2035 future-dated counterfactual captured event: strict refusal before any release inference.\n6. Parallel PLUS unknown-stock degradation and DekaMarkt unavailable-stock degradation: exactly two retailer/kind alerts, no cross-store leakage.\n7. Input-source row permutations: six identical historical records must not produce phantom archive drift.\n8. Programmatic source getters and Proxy traps through the combined drift API: reject without evaluating active caller code.

Every accepted case also independently verifies the six retailer/source partitions, immutability of the input batch, aggregate privacy redaction, no HTTP/public price/current availability, and invariant `releaseDecision: hold`.

## Evidence limits / promotion
All data are checked-in reviewed **historical** M1 fixtures. Alternative fact/status/source SHA and capture clocks are explicitly synthetic in-memory test inputs, **not real observations**. Tests do not fetch anything, grant PLUS/DekaMarkt permission, or validate public savings. No claim of true availability or current prices.

Gate a merge on the exact immutable branch head's hosted Node test suite, npm ci, high audit, M1 matching/permission gate, TypeScript/Vite build; ensure changed-files diff remains only this QA test and guide. Respect actual zCloud scoped lease/owner and applicable trusted VPS M3 workflow. Separate launch HOLD remains #74 written data rights; #78 actual 11+11 matched basket within 24h; #205 authentic field-code pin; #2833 permanent VPS gate. If a case is RED, keep PR draft, capture exact job evidence and file an owner-scoped issue; do **not** weaken assertions or change product-core from this lane.
