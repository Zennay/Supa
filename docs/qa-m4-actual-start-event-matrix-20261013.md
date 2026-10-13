# Independent M4 actual-start QA matrix — 13 Oct 2026

## Source and isolation

- Source frozen at exact **product integration** `ecab34d87394c9a1f61201663f6ee7b13826724f` from DRAFT #2115, which incorporates product owner #2114 and M3 #2111/#2113. Separate immutable QA base: `qa/frozen-m3m4-actual-start-ecab34d8-20261013`.
- This independent quality-validation branch adds **only this documentation and the new synthetic regression file** `tests/qa-m4-actual-start-event-matrix-20261013.test.mjs`. Do not modify original owner test `tests/m4-product-actual-session-start.test.mjs`, other QA branches/PRs, product source, workflows or main.
- Previously existing product test covers selected early events (plan, meal, baseline, late start), partial outcomes, inclusive timestamp, out-of-order arrays and one invalid CLI. This suite adds **16 event-kind negative validations**, 15 positive partial-session controls, offset-equivalent timestamps, strict identity-safe no-output CLI negatives and a real positive private mode-0600 CLI publication. It extends acceptance, rather than silently claiming ownership of product source or the prior QA suite.
- Tests are offline and fictional, do not use external URLs or any real person/retailer evidence. Synthetic `m3Gate.status=closed` is **not proof** that human M3 #78 has completed. Completed M4 beta and M5 **remain ineligible**.

## Independent acceptance / evidence contract

1. Each supported event type other than the start itself must fail when its timestamp is between broad `startedAt` and the actual `beta_session_started.timestamp` (the gap discovered in issue #2107). This includes the closure event and orphan potential metrics.
2. Normal valid partial events after the actual start must preserve inputs, abstain from public claims, never echo participant keys, and preserve abandoned/unknown outcomes.
3. The actual start time is inclusive; timezone offset-equivalent instants count as simultaneous. An event one minute before must fail even if lexical strings appear later. Event array order is not a time-order contract.
4. Three independent CLI failures must exit nonzero, print no report on stdout, publish no derived report, retain the private input byte-for-byte and not echo fictional identifiers. The positive CLI must use a new 0600 report with no participantKey, no M3 fictitious evidence reference, no public eligibility, and no secret-bearing stdout.
5. Exact new QA HEAD requires real GitHub-hosted `npm ci`, `npm audit --audit-level=high`, all unit tests (zero failures/skips), M1 matching/source-permission checks and TypeScript/Vite build; record immutable SHA and job links. Permanent VPS/mobile/M3/Firefox applicability is separate. Do not mistake earlier product CI 787/787 on #2115 for this *new* QA-head proof.

## Coordination and release gate

**DRAFT / HOLD / NO MERGE / NO DEPLOY**. Existing #2107 and original QA #2109 remain open and retain ownership; this matrix is a separate add-only test surface. Do not merge to shared `main`, trigger real M4 research, or claim permission/recruit participants. zCloud independent preflight + SQLite write-lease, original owner review, latest-main integrated acceptance, permanent runner evidence where applicable and explicit human release authorization are required before promotion. M3 genuine PLUS+DekaMarkt 11+11 same-demand field issue [#78](https://github.com/Zennay/Supa/issues/78) remains open.
