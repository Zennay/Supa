# Frozen original retailer inventory regression — merge-base pin

The original QA 12-test blob is **unchanged**: `9c3604cc9a2e193c5455d3dbec67301034bf037c`.

Original product code is pinned to branch `chatgpt/qa-frozen-retailer-original-7e2bac-20261014` at exact `7e2bac3bd0c36493922c865fb6c0bd9492b3f9df`. This branch is the **explicit base of QA DRAFT #2353**. The concurrently moving [product #2350](https://github.com/Zennay/Supa/pull/2350) has independently fixed same-ID label/public research citation drift on later source commits, so a GitHub pull request targeting the moving product branch falsely produced green tests on a merge containing the already-fixed source.

The old [CI #38516350023](https://github.com/Zennay/Supa/actions/runs/38516350023) **741/741 GREEN is not original RED evidence**. This additional QA-only documentation commit triggers an exact-head workflow on the frozen old source + original test blob. Expect five intentional RED of twelve independent synthetic QA scenarios; unchanged old product code, no retailer HTTP, actual prices or permissions.

Original RED is **never for merge**. A separate independent QA fixed replay branch has copied precisely the original QA test blob byte-for-byte onto the newer product head and supplies additional CLI evidence. M3 ACTIVE, genuine human field #78 still absent, M4/M5 INELIGIBLE. DRAFT/HOLD/NO MERGE/NO DEPLOY until zCloud lease/owner reviews, true rights and human go.
