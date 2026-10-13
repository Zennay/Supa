# SUPA M3/M4 evidence release-gate matrix (QA #2063)

**State: DRAFT / HOLD / NO MERGE / NO DEPLOY.** Synthetic checks are not human field evidence, retailer reuse permission, or beta authorization. Current canonical baseline is `main` at `c36f5c8f71d77cae94663978b51a194e9b183af6` (2026-10-13 preflight). Exact PR head, independent CI, permanent VPS gates, owner lease, review and explicit approval **must be filled with verified evidence** before any release decision; an empty cell means **NOT VERIFIED**, not success.

| Proposed claim or transition | Required positive evidence | Mandatory negative control | Current gate |
| --- | --- | --- | --- |
| M3: one full-basket comparison | Actual PLUS baseline plus DekaMarkt candidate, **identical canonical eleven demands on both sides**, same in-store/online-order context, timestamps <=24 h apart; independently verified pack, availability, price, quantity and source per row; saved original observation sheet and read-only derived report | 11+11 explicitly observed-unavailable fictional rows remain `unknown`, with `deltaCents=null`, `savingsCents=null`, 0 matched rows, never public-claim eligible; an unobserved `available:null` row fails conversion | **OPEN** — human [#78](https://github.com/Zennay/Supa/issues/78); synthetic only |
| M3: financial improvement | Measured comparable whole baskets, explicit baseline, reproducible integer-cent assessment, checked effect attribution (offer/pack/planning/unknown) and reviewer decision | Candidate may be worse or equal; incomplete rows, unsafe money, stale evidence and unverifiable effects must never be represented as money saved; even one claimable observed week has `publicSavingsClaimEligible=false` | **HOLD** — no public savings claim |
| M3: privacy and provenance | Source evidence ID, store identity, observed-at time, consent/right-to-use and protected provenance retained in private study; published outcome derived from that source | No `participantKey`, private provenance note or direct identifier in public-safe report; synthetic positive/negative controls may use only invented identifiers | **HOLD** — privacy review required |
| M3: file integrity | Converter and assessor write to *distinct*, independently reviewed destination without altering input bytes; safe atomic output, concurrency and interrupted-write behavior verified | Identical/normalized/symlink/hardlink aliases must not clobber inputs; concurrent writers must not mix output, expose partial old/new bytes, weaken permissions or follow swapped symlinks | **OPEN** — [#2035](https://github.com/Zennay/Supa/issues/2035), [#2039](https://github.com/Zennay/Supa/issues/2039) |
| M4: planning effort | Only **consented, eligible** beta sessions after genuine M3 closure; paired baseline-vs-SUPA timing, edits and decision counts with clear missing/abandoned handling | Reject unsafe integer duration, budget, decision/edit counts, repair-manual-edit aggregate overflow; do not turn missing metrics into zero or successful time savings | **HOLD** — [#2049](https://github.com/Zennay/Supa/issues/2049); no beta |
| M4: flexibility and trust | Consent; week-over-week scheduled changes, repairs, adherence, leftovers, explanatory understanding and interview/return-intent with provenance and privacy review | Unknown, abandoned, skipped, swapped, missing follow-up and conflicting evidence must remain distinguished; no fake successful adherence or privacy leak | **HOLD** — M3 #78 and human approval missing |
| M4: eligibility transition | M3 original field evidence accepted; exact-head all-green CI and applicable permanent VPS/browser/mobile proof; current-main replay; independent zCloud preflight/write claim/lease; owner and QA reviewer approval; explicit release decision | An M4 event that sets `m3Gate.status=open` must fail even with otherwise valid synthetic session fields; no override by a manually written `closed` flag alone | **HOLD** — no approval recorded |

## Independent executable QA for this issue

- `tests/qa-m3-m4-release-gate-evidence-matrix.test.mjs` exercises **actual** canonical sheet generator, converter, report and M4 validator, not duplicated fake comparison functions.
- Canonical 11+11 row identity and explicitly unavailable observations are checked independently: unresolved rows must not carry measured-price fields; zero accounting totals are **not** evidence of zero-cost baskets.
- Deliberately inserted fictional price details behind `available:false`, a partially measured candidate and incomplete collection metadata cannot produce a public savings claim.
- Privacy controls prevent serialized participant key and original private source notes from appearing in the derived report.
- M4 open-gate input is rejected before accepting any fake beta session.
- This test deliberately **does not** assume fixes from other active issue owners: [M4 safe-integer #2049](https://github.com/Zennay/Supa/issues/2049), [M3 alias #2035](https://github.com/Zennay/Supa/issues/2035) and [output atomicity #2039](https://github.com/Zennay/Supa/issues/2039) remain independent gating suites with their own expected-RED drafts, fix approvals and separate acceptance.

## Approval record — all mandatory before release/merge

| Proof | Status | Exact evidence |
| --- | --- | --- |
| Current `main` and dedicated QA branch | Created from `c36f5c8f71d77cae94663978b51a194e9b183af6` | See linked draft PR; final head must be rechecked |
| Exact-final-head hosted `npm ci`, full tests, high audit, M1 matching benchmark, M1 permission gate, TypeScript/Vite build | **NOT VERIFIED** | Do not infer from a prior SHA |
| Relevant permanent self-hosted VPS / M3 evidence and Firefox/mobile evidence | **NOT VERIFIED** | Link actual successful runs and artifacts, not a queued workflow |
| Independent zCloud preflight, write claim and lease for QA scope | **NOT VERIFIED** | Never assume GitHub branch creation is a zCloud claim |
| Current-main conflict check and original source/QA owner review | **NOT VERIFIED** | Other workers' PRs remain untouched |
| Genuine same-demand human M3 observation with usage permission | **OPEN** | [#78](https://github.com/Zennay/Supa/issues/78) |
| M4 beta and public savings human sign-off | **NOT GRANTED** | Remain HOLD even if tests pass |

This is an independent synthetic validation proposal, not a release checklist that automatically becomes true when CI turns green. No collection, participants, real prices, retailer scraping, code deployment, merge, or production evidence change is authorized by this document.
