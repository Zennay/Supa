# Offline capture-root identity: distinct historical source contract

**Issue:** [#2170](https://github.com/Zennay/Supa/issues/2170) ·
**Source chain:** frozen M5 chronology product [#2180](https://github.com/Zennay/Supa/pull/2180).
Scope: **future manual offline M5 preparation only**, not data acquisition, live
retailer integration, current M3 proof or M5 release.

## Physical identity before comparison

Before inspecting any source HTML or producing a human reviewer queue, both
manifest structures must pass the existing size, shape and raw-success checks.
If a historical directory argument was provided, the comparator obtains
filesystem identity for both nominated capture roots using the follow-symlink
`stat()` device and inode pair (`dev`, `ino`), and rejects:
- passing the exact current directory twice;
- a lexical alias (for example `/path/current/.`);
- a symlink alias naming the *same underlying capture directory*.

Two **different physical** roots with independent valid collection
timestamps may be compared, including when their fictional HTML has identical
bytes/SHA-256. The strict chronological check from source #2180 still requires
a baseline observation strictly older than its current counterpart.
A same-object refusal is **not** turned into `P3 unchanged`.
The operator CLI reports only its pre-existing generic failure message and
emits **no JSON on error**, no raw paths, source IDs or HTML.

This is an offline preflight: a concurrent privileged filesystem mutation
between the `stat` identity check and file reads is not guarded against;
there is no race-free snapshot or production-grade filesystem permission claim.
Local file symlinks and symlinked supermarket subfolders are a separate
provenance finding [#2168](https://github.com/Zennay/Supa/issues/2168) and
require independent work/review.

## Evidence & ownership

The 5 new product synthetic CLI tests cover P2 no baseline, separate
chronologically older root P3 manual-only, same argv alias rejection, trailing
`/.` alias rejection, and same-object symlink root rejection. All use tiny
local SHA-verified invented HTML, no retailer network, customers or prices.
Original independent QA [#2171](https://github.com/Zennay/Supa/pull/2171)
is not modified; its frozen test must be replayed by the independent owner
on this corrected product candidate.

**Gates:** Supa is M3 ACTIVE. Human same-demand PLUS 11 + DekaMarkt 11
observations within 24h [#78](https://github.com/Zennay/Supa/issues/78)
remain open. Rights/selector/production/M5 eligibility are all false.
**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud SQLite
scope/claim/write lease, original product and QA owner review, latest-main
reconciliation, applicable trusted CI/VPS and explicit release go.
