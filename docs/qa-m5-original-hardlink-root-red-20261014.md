# Original-source independent M5 cross-inode/root-first RED provenance — 2026-10-14

## Source freeze and isolation

- **Original pre-fix source:** [product DRAFT #2189](https://github.com/Zennay/Supa/pull/2189), exact `208c9a20a6244df27a1441dfda31f086300f9b11`. It includes conservative 8MiB resource protection, chronology and basic regular-file/symlink-root checks, but **predates** separate hardlink [product #2193](https://github.com/Zennay/Supa/pull/2193) and early root-before-manifest [product #2195](https://github.com/Zennay/Supa/pull/2195) corrections.
- **Unchanged independently authored QA case source:** [QA DRAFT #2196](https://github.com/Zennay/Supa/pull/2196), exact corrected-source QA HEAD `7509770465df974fb2c9fabf7d98cba0eb10211f`, independent test Git blob `655514ba85191d72bacff428ba17074b95d9f7e0`, **10 exact byte-identical cases**. Corrected source [hosted CI #38495138044](https://github.com/Zennay/Supa/actions/runs/38495138044) **865/865 PASS**, npm high audit, source-rights, matching and build GREEN, with same ten tests and 61 immutable older acceptance cases.
- This new isolated **QA-only RED branch** adds *only* the **exact same original test blob** and provenance doc on the frozen pre-fix source. No production, product owner, other QA, main, workflow, VPS or retailer files altered.

## Expected authentic original-source distinction

Three positive scenarios (regular independent P3, regular current P2, actual P1 failed capture) should stay GREEN. Negative cases with same hardlinked HTML inode across two otherwise distinct historical capture roots, hardlinked manifest inode, failed-capture manifest hardlink, root symlink with malformed manifest, and ancestor symlinks before manifest parse should fail precisely in the pre-fix source. The *specific* failure count and explanation must be taken from GitHub-hosted exact-head logs, not assumed or invented.

Synthetic SHA-correct tiny local HTML only, no actual retailer access, customer identifiers, real observations, rights, cash or savings.

**Do not merge or deploy expected-RED regression into any source.** This is an immutable original RED counterpart to green #2196 to show that independent tests were not written as always-green cosmetics.

Supa **M3 ACTIVE**; [issue #78](https://github.com/Zennay/Supa/issues/78) real human same-demand 11 PLUS / 11 DekaMarkt within 24h remains OPEN. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independently proven zCloud SQLite task/write preflight+claim lease, original owner reviews, latest-main reconciliation, applicable trusted permanent VPS and human releasego.
