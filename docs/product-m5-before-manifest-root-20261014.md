# M5 offline root-origin check before opening manifests

**Context:** [#2168](https://github.com/Zennay/Supa/issues/2168),
source owner [#2193](https://github.com/Zennay/Supa/pull/2193) frozen at
`275f664865e57976e6dbb35459526e1f90ef70bd`. This is a future-M5
**private offline human-review** input boundary only, not retailer ingestion,
savings evidence, an M5 eligibility decision or production release.

Previously the M5 comparator checked that capture roots and successful
HTML/store files were nonsymlink regular filesystem objects, but did so
**after** the raw manifests had already been read. A symlink-root alias
could therefore cause the tool to parse a manifest from a different physical
tree even though it would subsequently refuse to create a reviewer queue.

The comparator now checks both requested capture **roots** before opening
*either* manifest. It requires each nominated root to have a regular
nonsymlink directory inode, with its resolved real path equal to the
lexically resolved path (preventing ancestor-directory symlink aliases).
The existing validation still checks **both manifest structures** before
opening source HTML, and continues to reject symlinked/linked manifests,
HTML/files and excessive byte cohorts. Genuine regular current and distinct
older historical capture directories remain usable for P2/P3 manual review.

Five product-owned synthetic tests verify a valid regular P2, that root and
ancestor symlinks are refused before parsing deliberately malformed
borrowed JSON, that an aliased baseline is refused ahead of malformed
current manifest parsing, and that regular independent older roots retain
manual P3. Original independent QA suites remain untouched.

This stat/realpath preflight **is not** descriptor-pinned race-free reading
and does not guarantee immunity to privileged concurrent directory
replacement or bind mounts. It only closes the avoidable *normal-path*
read-before-root-check behavior.

**M3 ACTIVE:** actual human same-demand 11 PLUS + 11 DekaMarkt observations
within 24 hours [#78](https://github.com/Zennay/Supa/issues/78) still open.
M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent
zCloud SQLite write scope/claim/lease verification, source/QA owner review,
latest-main integration, applicable permanent VPS validation, and explicit
human release authorization.