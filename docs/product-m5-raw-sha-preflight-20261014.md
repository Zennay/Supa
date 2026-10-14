# Offline M5 raw success digest admission

**Issue:** [#2206](https://github.com/Zennay/Supa/issues/2206) ·
**frozen owner:** [product DRAFT #2205](https://github.com/Zennay/Supa/pull/2205),
commit `28a8f1a7f6ac4961a3010da80bbeaa09c48dca54`.

Before any success-claimed M1 HTML read, the future offline M5
comparator now rejects an entire raw manifest with a missing,
non-string, non-lowercase or non-64-character SHA-256
`sha256` on any `success:true` row. This is a **grammar check**,
not a proof of content integrity. Canonical M1 inspection must still
calculate and compare the actual HTML digest; a 64-character but
incorrect digest remains a failure.

The guard applies to both current and historical inputs, including
later rows after an earlier successful-looking record. Unavailable
P1 rows require neither HTML nor a digest. Distinct ordinary
SHA-verified sources retain private manual P2, independent strictly
older roots retain private manual P3. Pre-existing 8MiB
per-source/whole-tree source budgets, bounded 8MiB descriptor
manifest reads, unique safe source IDs, store and kind origins,
root/file trust checks and explicit observation chronology remain.
No private source information is emitted on operator-CLI error.

Eight product-owned synthetic local tests cover P2/P1/P3 valid
controls plus absent/non-string/uppercase/short current SHA,
and malformed historical SHA with current HTML deliberately
absent. All examples use invented SHA/HTML and
`example.invalid`; no actual retailer evidence, API access,
customer data, shopping prices or savings.

**Scope limits:** This early grammar check does not alter the
independent M1 HTML inspector, perform a network request, make
manifest+HTML reads an atomic filesystem snapshot, or
authorize M5. Existing TOCTOU conditions on later HTML and
manifest rereads remain; independent QA must assess this
separately.

**Supa M3 ACTIVE:** first genuine same-demand PLUS baseline
and DekaMarkt candidate 11-line human observations within
24h [#78](https://github.com/Zennay/Supa/issues/78) remain open.
M4/M5 not eligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY**
pending independent source/QA owners, zCloud SQLite scope/claim/
task-write lease proof, safe current-main and applicable
permanent trusted runner verification, real field evidence and
explicit human releasego.
