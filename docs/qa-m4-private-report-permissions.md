# M4 private output mode: synthetic Linux CI matrix (expected RED)

## Evidence boundary
Read-only main source inspected: `scripts/m4-validate-beta-session.mjs` from `c36f5c8f71d77cae94663978b51a194e9b183af6`. Associated issue [#2091](https://github.com/Zennay/Supa/issues/2091). The CLI uses `writeFile(output, serialized, 'utf8')` for a **private** M4 summary. It supplies no explicit file mode, and does not reject/fix a permissively readable pre-existing destination.

The QA test creates a disposable `0755` local parent folder, explicitly invokes the actual exported `main` inside a subprocess with controlled `process.umask()`, and reads back mode bits. No real participants, identifiers, receipts, supermarket prices, research evidence or network calls are involved. The fixture's closed M3 marker is **artificial only**: genuine M3 [#78](https://github.com/Zennay/Supa/issues/78) OPEN, M4 ineligible.

## Acceptance matrix
| Scenario | Expected |
| --- | --- |
| New report with caller `umask 077` | PASS: private `0600` mode, no stdout, no raw participantKey |
| Real gate status open | PASS: validation error, output absent |
| New report with caller `umask 022` | **RED** until corrected: must remain `0600`-equivalent, never accessible to group/other |
| Existing destination `0644` with caller `umask 022` | **RED** until corrected: either refuse without touching existing bytes or publish securely with restrictive resulting mode |

Reproduce with `node --test tests/qa-m4-private-report-filemode-red.test.mjs`. These are tests of an existing file-permission contract, **not** a race proof. Simply passing `mode: 0o600` for new files does not change an existing mode-0644 file on `writeFile`; coordinate safe output publication with original owner [#151](https://github.com/Zennay/Supa/pull/151) and alias/concurrency [#2086](https://github.com/Zennay/Supa/issues/2086). CLI option ambiguity [#2088](https://github.com/Zennay/Supa/issues/2088) and direct-ID metadata [#2084](https://github.com/Zennay/Supa/issues/2084) remain independently owned.

**DRAFT/HOLD/NO MERGE/NO DEPLOY**. Need independent zCloud preflight/lease, source-owner review, corrected-head hosted and applicable permanent VPS checks, latest-main composition and explicit release authorization; no public savings or M4 beta claims.
