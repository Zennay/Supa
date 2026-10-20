# Independent Supa M4 source-output inode safety (QA #2086)

Current Supa phase: **M3 active**, human same-demand PLUS+DekaMarkt #78 OPEN, preparatory M4 **INELIGIBLE**. This quality-validation work does not create real M4 evidence, authorize beta sessions, or allow release.

## Controlled bug

Canonical M4 CLI `scripts/m4-validate-beta-session.mjs` builds a private derived summary from a source session and unconditionally calls `writeFile(output, serialized)`. `--output` is not checked against the input pathname or underlying file identity. A user selecting the same file or another filesystem name pointing to that inode will overwrite the **only private source record** with the summary and lose replayable consent/events.

The issue is distinct from the owner-maintained M3 CLI same-inode issue [#2035](https://github.com/Zennay/Supa/issues/2035) and concurrent publication [#2039](https://github.com/Zennay/Supa/issues/2039), because this defect concerns a different M4 entry point. All original M4/M3 source branches remain untouched.

## Runnable isolated synthetic acceptance

`tests/m4-source-output-inode-qa.test.mjs` uses the real exported M4 `main()` and only automatically cleaned temporary files. The test-session M3 gate is artificially closed **for validator testing only**.

- **GREEN:** distinct output file stores only a private summary, with `publicClaimEligible=false`; source JSON remains byte-identical and participant pseudonym is excluded from summary.
- **EXPECTED RED:** identical input/output pathname must be rejected before writing and leave the source byte-identical.
- **EXPECTED RED:** output symlink to input must be rejected before writing and leave source byte-identical.
- **EXPECTED RED:** output hardlink to input must be rejected before writing and leave source byte-identical.

The regressions test integrity of simple path/inode aliases, not a claim that broader symlink-swap or multiwriter TOCTOU races are solved. Source-owner repair should coordinate atomic, race-resilient output policy with issue #2039 and ensure owner-only source changes do not interfere with M4 timestamp [#151](https://github.com/Zennay/Supa/pull/151), numeric #2049, event time #2073, basket #2075 or summary privacy #2084.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until original owner review, independent zCloud lease/preflight, exact repaired-head hosted and VPS gates, latest-main integration, real human M3 #78 and explicit release authorization.
