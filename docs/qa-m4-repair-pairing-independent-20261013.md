# SUPA M4 repair-causality QA — independent frozen snapshot

**Issue:** [#2110](https://github.com/Zennay/Supa/issues/2110) · **Original source:** `main=c36f5c8f71d77cae94663978b51a194e9b183af6` · **State:** DRAFT / HOLD / NO MERGE / NO DEPLOY.

## What the executable checks establish

The original `scripts/m4-validate-beta-session.mjs` accepts `repair_started` and `repair_completed` as separately valid event records. Its privacy-safe M4 summary uses every completed repair as one instance in `repairCount`, median duration and total manual edits, but currently has no causal pairing check. Tests use only self-contained, fictional events with whole-minute ISO timestamps and a *synthetically* marked closed M3 gate. **No real participant, retailer, baseline, permission, savings measurement or permission to conduct M4 beta exists in this branch.**

The new `tests/m4-repair-pairing-independent-qa.test.mjs` is add-only and exercises the unchanged original source and actual CLI (**12 cases: 7 positive controls, 5 intentional expected RED**):

| Check | Expected on frozen source | Required acceptance after source-owner fix |
| --- | --- | --- |
| One start and one same-kind later completion | GREEN | Count 1, median 180 sec, edits 2, private report, no mutation |
| Two separate same-kind starts and completions | GREEN | Count 2, median 120 sec, edits 3; do not reject legitimate repeat repairs |
| Interleaved different repair kinds, both started first | GREEN | Match per kind; count 2, median 135 sec, edits 3 |
| No repair events | GREEN | Count 0, median null, edits 0 |
| Abandoned session with unmatched start | GREEN | Preserve partial record, no invented completion |
| Unknown session with unmatched start | GREEN | Preserve partial record, no fabricated duration or return intent |
| Real CLI with valid paired repair | GREEN | Reports count/median/edits without stdout or participant key; input unchanged |
| Completion without any start | RED | Reject rather than inventing observed repair effort |
| Completion one minute before its start | RED | Reject regardless of array ordering |
| Completion kind differs from preceding start | RED | Reject mismatched causal pair |
| Duplicate completions with only one start | RED | Consume each start once; never double-count it |
| Real CLI orphan completion | RED | Nonzero status, no report/stdout, source bytes and private identifiers preserved |

The original source must not be modified by this QA PR. A later separately owned fix can pair events per kind by timestamp, while preserving multiple legitimately distinct repair cycles (each with a different start). Define behavior for completed sessions with dangling *starts* separately; abandoned/unknown sessions must retain partial evidence, not fabricate completions. Avoid conflating `duration_seconds` instrumentation with wall-clock duration until research protocol defines that contract.

## Ownership and unrelated gates

- [#2107](https://github.com/Zennay/Supa/issues/2107) owns completed plan-start→completion→closure chronology and its own QA [#2109](https://github.com/Zennay/Supa/pull/2109). Do not amend or retest its narrow scope in this PR.
- [#2073](https://github.com/Zennay/Supa/issues/2073) owns sub-millisecond timestamps; this test uses distinct whole-minute times.
- [#2049](https://github.com/Zennay/Supa/issues/2049) owns safe integer arithmetic; no numeric extreme inputs here.
- No edits to original product source, existing tests, CI workflows, shared `main`, personal observation files or other workers' branches.
- **Human M3 [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN.** M4 remains ineligible until one genuine, same-demand PLUS + DekaMarkt basket pair within 24 hours has been captured and assessed through canonical M3 evidence gates. The fictional `m3Gate.status=closed` is a narrow test precondition only.

## Release / verification

Expected RED proves the source does not yet enforce this causal relation; it is not a production incident and **not a corrected all-GREEN quality gate**. Hosted CI failure from exactly the anticipated 5 cases may be used to confirm the gap. Do not call any downstream build, VPS or browser gate green when skipped. Source-owner review and remediation, independent zCloud write preflight/lease, corrected exact-head CI + applicable permanent VPS, latest-main composition and explicit human approval are required before merge/deploy. Do not close the human M3 evidence issue or make public claims on synthetic cases.
