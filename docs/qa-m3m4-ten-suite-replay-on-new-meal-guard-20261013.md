# Independent 82-case M3/M4 QA replay after latest product meal/session integrity changes

**Current frozen product source**: [DRAFT combined #2115](https://github.com/Zennay/Supa/pull/2115) exact `ecab34d87394c9a1f61201663f6ee7b13826724f`; source remains owner-controlled, not modified by QA. Earlier product head `682dffbf5b02e00b880a6d40d1f599b6cedac111` was independently checked on [DRAFT QA #2122](https://github.com/Zennay/Supa/pull/2122) HEAD `69d013247cd3da74a80e9a6026a58661eb055144`, [hosted CI #38476059700](https://github.com/Zennay/Supa/actions/runs/38476059700) **820/820 PASS**.

## Source delta and non-conflicting QA purpose

The new source adds a stricter private M4 session-start and per-meal identity/duplicate-adherence policy, new owner-only test/docs evidence and **no real M3 field observation**. Latest source compare between frozen old and new product heads: 2 commits ahead / 0 behind; script `scripts/m4-validate-beta-session.mjs` +49/-0, two owner tests and two docs. The task here is verifying **existing ten independently originated regression contracts** still hold on this exact new source head.

Copied **all ten test files byte-for-byte** from *already all-green QA #2122* with unchanged blobs (82 QA scenarios total):
- M3 study week [#2094](https://github.com/Zennay/Supa/pull/2094), six; `fa8742c710ba07dc5ef8ac94de246a57b462f9b9`.
- M3 private identity [#2096](https://github.com/Zennay/Supa/pull/2096), fourteen; `800a4e48e3a1ce777906bfb9fcd842bbde600d6d`.
- M4 completed-week causal lifecycle [#2109](https://github.com/Zennay/Supa/pull/2109), nine; `98dbdfd41d3a32de812261eb62702fe7bb9990a8`.
- M4 repair pairing [#2112](https://github.com/Zennay/Supa/pull/2112), twelve; `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`.
- M4 basket unknown [#2076](https://github.com/Zennay/Supa/pull/2076), ten; `cd2b5ad8da84b04152ee1ab71103720aad03ec68`.
- M4 summary direct IDs [#2085](https://github.com/Zennay/Supa/pull/2085), nine; `af7978edbad46460c5a1262f869d7eaa139781be`.
- M4 strict output flags [#2089](https://github.com/Zennay/Supa/pull/2089), six; replay blob `80d8e338d791aacecefdb09519baf5ad3e825ee7`.
- M4 private output 0600 [#2092](https://github.com/Zennay/Supa/pull/2092), four; `fed04f05e8df817b8e3f2d5966cf9b29cf4d0030`.
- M4 safe integer [#2050](https://github.com/Zennay/Supa/pull/2050), eight; replay blob `e059512eadaf34b4b3f14f48cd80ee0fc7aaa4cd`.
- M4 source-output inode [#2087](https://github.com/Zennay/Supa/pull/2087), four; `57be882632bae08e80573b8b07cf1f577658b9d2`.

**No new test semantics or fixture modifications on this latest source replay**: ten files are exact byte copies of last certified green #2122 QA head. The two historic test-only compatibility accommodations from old original independent #2050/#2089 are preserved transparently: numeric fixtures include prior matching `repair_started` for #2110 causal semantics; CLI test expects exact stricter `--output requires a non-flag file path`. All numeric/privacy/output/no-overwrite assertions remain strict, original QA source PRs never modified.

Full hosted `npm ci`, high-severity audit, 82 QA regressions plus product tests, M1 matching benchmark, source permission and production build must be green on the **exact latest QA SHA** before claiming continued cross-fix compatibility. Applicable permanent VPS, independent zCloud scope claim/lease, owners' review, newest-main integration, human release gate remain separate; held even with hosted success.

**M3 ACTIVE**: genuine same-demand 11+11 PLUS+DekaMarkt [human field #78](https://github.com/Zennay/Supa/issues/78) OPEN, no real savings, recruitment, retailer network, proxy/scraping, or real M4 beta. **DRAFT/HOLD/NO MERGE/NO DEPLOY**.
