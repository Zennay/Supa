# SUPA QA 2/2 — latest M5 hardlink and early root admission evidence (14 October 2026)

## Milestone, scope and frozen ownership

- Supa is **M3 ACTIVE**. Genuine human [field issue #78](https://github.com/Zennay/Supa/issues/78) same-demand PLUS 11 lines and DekaMarkt 11 lines within one 24-hour observed retail context remains OPEN. M4/M5 not eligible; this QA has no retailer network, real price, savings claim, production deployment or customer data.
- Product owner [DRAFT #2195](https://github.com/Zennay/Supa/pull/2195) exact SHA **`f44a77d67c906e72b80fd132044bc599735a3333`**, frozen child of [#2193](https://github.com/Zennay/Supa/pull/2193) exact `275f664865e57976e6dbb35459526e1f90ef70bd` and corrected #2189 strict 8MiB source.
- QA owns ONLY its new independent 8-case test + 12 **unaltered** original independent QA test files and this evidence note, on a separate branch. No owner/workflow/main, other QA or permanent VPS changes.
- Prior [QA DRAFT #2194](https://github.com/Zennay/Supa/pull/2194) exact HEAD `5ffac8e0c12eb4f8b95c2b6ce57b40264093db8f`, [hosted CI #38494449187](https://github.com/Zennay/Supa/actions/runs/38494449187) **844/844 PASS**: original **61** independent QA cases from #2164 (34), #2174 (9), #2171 (4), #2169 (8), #2166 (6), all byte-identical.
- Replayed 12 original files in this branch are exact same original Git blobs, verify by comparing `git ls-tree` or `fetch_file.sha` to previous #2194; no original assertion altered.

## Ten additional independent new acceptance cases

These focus on **cross-capture physical alias relationships and precedence** not just the isolated synthetic product fixture:
1. Two SHA-matching, independent regular captures with strictly older true baseline are private P3 and never grant rights, selectors, production, or M5.
2. Canonical SHA-valid current without baseline remains P2, manual-only.
3. Truly failed first capture remains P1 and requires no HTML.
4. Two distinct directory roots with the **same hardlinked HTML inode** fail closed when examined in either order; no reviewer JSON is published.
5. Two distinct roots sharing a **hardlinked manifest inode** fail closed even with valid parseable JSON.
6. Hardlinking a *failed-capture* manifest to another path must not bypass manifest provenance as a normal P1.
7. A symlink alias root with deliberately malformed manifest must be refused as root-origin error **before** JSON is read (direct comparator API + CLI).
8. A symlink alias **baseline** must be refused before parsing a deliberately malformed **current** manifest (both roots admitted before either manifest read).
9. A current root underneath a **symlinked ancestor directory** must likewise be rejected before its malformed JSON is read.
10. A historical root underneath a **symlinked ancestor directory** must be rejected before reading deliberately malformed **current** JSON.

All inputs are fictional short SHA-verified HTML or manifest strings under fresh local temporary directories; direct API error assertions distinguish unsafe precedence from incidental JSON rejection. CLI checks normal process exit, exact generic private stderr, no JSON for rejection, preservation of input bytes and verified inodes. No adversarial network scanning or live retailer access.

## Gates and limitations

Require exact QA head GitHub-hosted `npm ci`, high audit, **all original 61 plus new 10** original independent cases, M1 matching, source-permission gate and TS/Vite build before technical GREEN. A green synthetic hosted run is **not** current-main merge proof, race-free descriptor-bound filesystem security, permanent trusted runner proof, actual M3 retailer observation or authorization for M4/M5.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud SQLite task/write scope preflight+claim lease, owner reviews, latest-main controlled integration, relevant trusted permanent VPS, true #78 human field observations and explicit human releasego.
