# M4 original QA #2112 → source-owner #2114 independent all-green replay

**Frozen product parent:** `ef7dfaf7d85eefc592580ba14d592f0a0571bc18` from [DRAFT product #2114](https://github.com/Zennay/Supa/pull/2114). **Original independent QA:** [DRAFT #2112](https://github.com/Zennay/Supa/pull/2112) on immutable test blob `e6245a3b7ea2d30b572b6de87e24c8f42a17404a`. **Issue:** [#2110](https://github.com/Zennay/Supa/issues/2110).

## Traceability
`tests/m4-repair-pairing-owner-fix-replay-2110.test.mjs` is byte-for-byte identical to the twelve-case original `tests/m4-repair-pairing-independent-qa.test.mjs` from original QA head `5975857c3dbf50f803e38a98cfcfcd3334fbf568`. No reinterpretation, weakening, mocking or changing expectations to produce green results.

Seven successful original controls must remain green: valid repair, no repair, abandoned/unknown partial evidence, repeated same-kind and interleaved distinct-kind repairs, and actual successful CLI private summary. Five originally red controls must flip to green only because the owner's original source now rejects unmatched/earlier-than-start/wrong-kind/double-consumed completions and the actual CLI refuses invalid private reports.

## Test and release gates
- Run full `npm test`, clean dependency install, high npm audit, M1 matching benchmark, source-permission gate and production build on the **exact QA head**; record actual result rather than assuming #2114 source green covers independent tests.
- Retain separately the permanent VPS/mobile gate, original source owner's explicit review, coordination/lease and latest-main composition. No merge/deploy without explicit human authorization.
- This is **not** M4 study data. `m3Gate.status=closed` in wholly fictional fixtures is not a real gate closure. Genuine [M3 #78](https://github.com/Zennay/Supa/issues/78) PLUS+DekaMarkt observed 11+11 paired-basket evidence still OPEN. M4/M5 not eligible.
- **DRAFT / HOLD / NO MERGE / NO DEPLOY.** This frozen replay can never silently update original source #2114, original QA #2112, current main, live price ingest, retailer rights, personal evidence or other workers' branches.
