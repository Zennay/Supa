# M3 durable evidence direct-identifier key aliases (QA, 2026-10-11)

## Finding

The repository-local `evidence/m3` privacy guard rejected only exact camelCase
key names for prohibited direct identifiers. Valid JSON can express the same
field using separators, case variations or Unicode-width forms (for example
`participant_name`, `PARTICIPANT-NAME`, `account.id`, or
`ｅｍａｉｌ＿ａｄｄｒｅｓｓ`). A non-email direct name value under these aliases
would evade the original exact-key denylist.

## Executable correction

`tests/m3-evidence-repository-boundary.test.mjs` now canonicalizes field keys
with Unicode NFKC normalization, removal of non-ASCII alphanumeric separators,
and lowercase comparison *before* checking the original six prohibited
identifier concepts. The case is covered by a focused synthetic nested-JSON
regression matrix with ten disallowed aliases and allowed pseudonymous
`participantKey` / `studyId` / store / ingredient / provenance controls.

The guard still scans all durable JSON evidence recursively and separately
rejects email-like values. This change narrows what can be committed to the
repository; it does not inspect external retailer systems, alter the collector
or converter, or process/store genuine field observations.

## Acceptance and status

Require exact-head hosted CI (including `npm test`, lockfile dependency audit,
source-permission gate, benchmark and build) and owner/current-main review.
Keep the isolated PR **DRAFT / HOLD / NO MERGE / NO DEPLOY** until coordinated.
The M3 field exit still requires actual consented/authorized same-demand
PLUS and DekaMarkt observations under #78. Synthetic test strings prove
only the repository boundary, not savings or pricing.
