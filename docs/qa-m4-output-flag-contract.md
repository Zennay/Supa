# M4 CLI output-option parser: isolated independent QA (expected RED)

## Frozen contract and scope
- Source under observation: `scripts/m4-validate-beta-session.mjs` from immutable `main=c36f5c8f71d77cae94663978b51a194e9b183af6`.
- QA issue: [#2088](https://github.com/Zennay/Supa/issues/2088).
- This patch adds only a new executable QA test and this document. No source repair, evidence file, UI, active owner branch, workflow or deployed code changes.
- Never treat the artificial `m3Gate.status='closed'` fixture as a real authorization: genuine PLUS + DekaMarkt M3 [#78](https://github.com/Zennay/Supa/issues/78) is open. **M4 is ineligible**.

## Reproducible source risk
`parseArgs()` sets `output = argv[index + 1] ?? null` for an explicit `--output` and later asserts `!output || output.trim().length > 0`. The missing-value case evaluates as allowed; `main()` then writes a private summary to stdout instead of a requested file.

Duplicate `--output` occurrences are accepted, silently discarding the prior target. When the next token equals `--output`, the program treats it as the literal output filename rather than identifying malformed option syntax. Both cases risk surprising file writes in a privacy-sensitive CLI.

## Real-source executable acceptance
Run `node --test tests/qa-m4-output-flags-red.test.mjs` on the exact SHA and full npm test suite in hosted CI.

| Case | Expected | Frozen-main observation |
| --- | --- | --- |
| Explicit distinct output path | PASS: private report, no stdout or source mutation | Should pass |
| Intentionally no output flag | PASS: deliberate private stdout contract, no file | Should pass |
| Whitespace-only output value | PASS: fail closed, no report | Should pass |
| Flag with missing value | **RED**: must error with no stdout | Currently prints report and exits 0 |
| Duplicate flag with two paths | **RED**: reject before writing either | Currently writes second target |
| Flag token used as filename | **RED**: reject before writing a file named `--output` | Currently writes that file |

Only a fictional **abandoned** session, opaque identifiers and a deliberately fictional M3 gate are used. CLI subprocesses run inside autocleaned temporary directories; tests perform no retailer request, scraping, user observation, real identity processing or network operation.

## Repair ownership and gates
Source owner [M4 timestamp PR #151](https://github.com/Zennay/Supa/pull/151) should coordinate the parser change. Validate exactly one `--output` with exactly one non-option destination, reject duplicates, parse all options **before any file write**, preserve intended no-flag stdout behavior. File/symlink/hardlink alias protections remain owned by [#2086](https://github.com/Zennay/Supa/issues/2086), direct-identifier metadata by [#2084](https://github.com/Zennay/Supa/issues/2084); do not pretend this QA suite addresses those issues.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until original owner review, independent zCloud preflight/write lease, exact corrected-head hosted CI and applicable VPS, latest-main integration, genuine human M3 field evidence and explicit release authorization. Expected failing CI is a demonstrated problem, **not green readiness**.
