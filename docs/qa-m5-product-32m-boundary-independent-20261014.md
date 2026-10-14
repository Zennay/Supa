# Supa future-M5 owner-policy 32 MiB boundary: independent synthetic QA

**Current phase M3 ACTIVE**; actual human [issue #78](https://github.com/Zennay/Supa/issues/78) 11 PLUS + 11 DekaMarkt demands within 24 hours remains open. No M5 eligibility, real retailer data, actual savings, source rights or production claims.

## Frozen source and scope
Product DRAFT [#2185](https://github.com/Zennay/Supa/pull/2185) pinned **`c14c2a3ce5de3500cc5dcd9488b180ccb55ad762`** declares an **8 MiB per successful HTML file and 32 MiB aggregate per capture tree** limit, after lstat regular-file/no-symlink checks and before M1 HTML read. Only this new independent QA test + provenance doc, no edits to product/previous QA/main/workflows/permanent VPS. Both tests create only invented, local SHA-256-verifiable HTML fixtures with `example.invalid` labels.

## Precisely distinct acceptance assertions
- **Exactly 32 MiB inclusive**: four independently SHA-verified, regular HTML sources of **8 MiB exactly** each, valid manifest, must preserve manual-only P2 for all four and maintain all rights/selector/production/M5 flags false.
- **Above 32 MiB**: the same four files plus one tiny correctly SHA-verified complete HTML source (each independently ≤8 MiB) must refuse the **whole** private review queue, nonzero exit, zero stdout, strictly generic stderr, files and manifest unchanged.
- No timeout or killed process may count as correct fail-closed behavior. Both cases verify exact input SHA and metadata after CLI execution. These are *product's chosen policy boundary tests*, not an alternative permitted contract decision.

## Crucial unresolved original QA conflict
Original independent [QA #2166](https://github.com/Zennay/Supa/pull/2166) requires **8 MiB total aggregate**. Original unchanged [QA DRAFT #2187](https://github.com/Zennay/Supa/pull/2187), [hosted CI #38493460451](https://github.com/Zennay/Supa/actions/runs/38493460451), has **785 total/784 PASS/one deliberately source RED** because two 5 MiB files are accepted under new 32 MiB product policy. Do **not** interpret owner-policy exact-boundary GREEN as resolution of that original stricter oracle. This is a defensible-budget policy decision for original owner and QA to reconcile, not proof of exploitation.

[QA #2188](https://github.com/Zennay/Supa/pull/2188) already proved 55 other immutable cases GREEN in [CI #38493726331](https://github.com/Zennay/Supa/actions/runs/38493726331), 834/834, on same pinned owner source; [QA #2190](https://github.com/Zennay/Supa/pull/2190) combines the original 61 including the known policy RED without relaxing it.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending explicit owner budget decision, independent zCloud task/write preflight+claim lease, original reviews, safe latest-main/applicable permanent VPS, human M3 field evidence and releasego.
