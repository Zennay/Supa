# Independent M4 repair QA on combined M3+M4 candidate

**Source composition:** [DRAFT product integration #2115](https://github.com/Zennay/Supa/pull/2115) at frozen immutable `8b90f3981c4544ec204123905528680c971bed4c`. This composes product candidate #2111 (M3 private metadata), #2113 (M3 observation week), #2114 (M4 causal protocol) and none of their independent QA PRs.

**Evidence replay provenance:** original QA [#2112](https://github.com/Zennay/Supa/pull/2112), [issue #2110](https://github.com/Zennay/Supa/issues/2110), old-main QA exact HEAD `5975857c3dbf50f803e38a98cfcfcd3334fbf568`, test blob `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`. New `tests/m4-repair-integrated-m3m4-qa-2110.test.mjs` is **byte-identical to the original 12-case test**. Only the file path distinguishes this isolated replay.

## Independent acceptance
- All **seven original positive cases** stay green: one paired repair; no repairs; abandoned/unknown sessions; two same-kind cycles; interleaved kinds; real CLI valid private summary with unchanged input.
- All **five original deliberately RED cases** become green strictly due to corrected source: no orphan completion; no backwards completion; repair kind matching; no duplicate consuming one start; actual invalid CLI must be nonzero with no private output.
- Execute full actual repository CI on the exact replay commit, including install, high audit, `npm test`, source-permission gate, matching benchmark and build. Cite the actual run/job and counts, not owner-hosted CI alone. Applicable permanent runner evidence remains a separate gate.
- No promotion of M3 #78 or M4: synthetic fixture closes its fake gate solely to exercise otherwise unavailable private-beta validation. Genuine PLUS+DekaMarkt basket observation #78 is OPEN. Not recruiting, not crawling, not deploying, not claiming real savings.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until independent zCloud write-preflight/lease, owner review, latest-main integration and explicit human approval. PR #2115 is *evidence-only*, not a merge vehicle. Keep owner PRs #2111/#2113/#2114, original QA #2112, existing workflows and main untouched.
