# SUPA M3 quality-validation: fail-closed release evidence gate

Status: DRAFT / HOLD / NO MERGE / NO DEPLOY. This is a QA acceptance contract, not observed retailer evidence.

## Required independent evidence

| Gate | Acceptance | Current evidence / outcome |
| --- | --- | --- |
| M3 human field (#78) | Genuine PLUS and DekaMarkt observation with consent, provenance, same canonical 11+11 requirements and comparable basket units | OPEN: no claim permitted |
| CLI timezone / DST (#2060) | Current-head hosted tests plus permanent VPS runner, exact commit SHA and logs | Hosted 677/677 PASS at `2c509d1466111de85b7f7492efa0fe4a49b3ac07`; permanent runner queued at handoff |
| Output preservation (#2035, #2039) | Same-file and alias rejection, symlink-swap/concurrent writer tests, exact source bytes unchanged on failure | OPEN: no release signoff |
| Numeric integrity (#2049) | Unsafe integer inputs and aggregate overflow rejected; null/unknown never converted to savings | OPEN: no M4 eligibility |
| Private/public separation | No participant key, private provenance note or personal marker in public-safe output; `publicSavingsClaimEligible:false` until field gate approved | Synthetic checks only |
| Deployment authorization | Independent zCloud preflight/write lease, owner approval, current-main integration, applicable VPS/Firefox/mobile evidence and explicit release authorization | NOT VERIFIED |

## Negative acceptance matrix

1. Missing either retailer observation: report `unknown`, monetary savings `null`, public claim forbidden.
2. Basket quantities or units mismatch: no full-basket savings claim.
3. Observation timestamps outside protocol window: no fabricated comparable price.
4. Candidate basket more expensive: preserve negative private delta; never present as positive saving.
5. Public report contains participant identifiers or private provenance: reject publication.
6. Output aliases input (including symlink): reject without modifying source bytes.
7. Concurrent writers or interrupted write: no partial report, no overwrite of protected source.
8. Any unsafe integer or overflowed aggregate: reject numeric evidence, not rounded acceptance.
9. Hosted CI green but permanent runner pending: HOLD.
10. No explicit owner/release authorization: HOLD even if all automated tests pass.

## Exit criteria

Close each evidence gate with immutable commit/run references and an independent reviewer; verify current-main composition and permanent environment tests. Only then consider separate approval to merge or deploy. M4 recruitment and public savings claims remain prohibited until genuine M3 field evidence is accepted.
