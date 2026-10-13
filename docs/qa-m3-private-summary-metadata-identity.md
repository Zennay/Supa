# Independent QA — M3 private report direct-ID metadata boundary

Tracker: [#2095](https://github.com/Zennay/Supa/issues/2095). **Scope is M3 derived JSON reports**, distinct from Markdown evidence scans [#1528](https://github.com/Zennay/Supa/issues/1528), visible-text check [#1823](https://github.com/Zennay/Supa/issues/1823), and M4 session-summary checks [#2084](https://github.com/Zennay/Supa/issues/2084). Frozen source: canonical `main=c36f5c8f71d77cae94663978b51a194e9b183af6`.

Run `node --test tests/qa-m3-private-summary-metadata-identity-red.test.mjs` (Node 22 strip-types support). All data is entirely **fictional**; canonical M2 11-line demand is filled using only controlled test fixtures. Never treat this as observed prices or genuine field evidence.

## Matrix

| Field under test | Safe control | Expected RED on current source |
| --- | --- | --- |
| `population` | `fictional student cohort` | `fictional cohort contact fictional.person@example.invalid` |
| `region` | `synthetic region` | `synthetic region assigned to fictional.person@example.invalid` |
| `baseline.basket.store.name` | `PLUS fictional branch` | `PLUS synthetic fictional.person@example.invalid` |
| `candidate.basket.store.name` | `DekaMarkt fictional branch` | `DekaMarkt synthetic fictional.person@example.invalid` |

Two distinct execution pathways: exported actual `buildObservedWeekReport()` and real M3 report CLI `--output` subprocess, each with one positive and four negative tests (**10 total**). Existing preflight validates nonempty strings and expected retailer substring, but copies unsafe fields verbatim into private summaries. Acceptance is **either explicit input rejection before any report** or safe deterministic redaction with preserved retailer semantics; never let an address enter serialized reports, even when `publicSavingsClaimEligible` remains false or `participantKey` is absent.

The real CLI tests use disposable per-case temp directories, explicit output paths, confirm byte-identical raw input and prohibit stdout for private reports. No network, retailer requests, account identifiers, contacts, permissions, consent claims or production data.

## Release boundaries

This reproduces a synthetic, source-derived privacy gap, **not a real leak**. The source-owner must define a coherent M3 metadata policy (including direct identifiers in other free-form summary fields) and patch source in a separate, coordinated workstream. This QA branch must not modify domain code, original M3 owner or independent QA PRs. Independent zCloud claim/preflight/lease, exact corrected-head hosted all-GREEN CI, applicable permanent VPS gates, latest-main composition, owner review and human release authorization are required. Genuine PLUS + DekaMarkt field [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN, M4 private beta ineligible.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
