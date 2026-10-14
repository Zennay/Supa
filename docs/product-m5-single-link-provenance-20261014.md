# Offline M5 owned-source inode provenance

**Issue:** [#2191](https://github.com/Zennay/Supa/issues/2191). **Frozen
parent:** [#2189](https://github.com/Zennay/Supa/pull/2189) exact SHA
`208c9a20a6244df27a1441dfda31f086300f9b11`. This is conservative
**future-M5 offline human-review** input handling, **not** live scraping,
M3 measured savings, retailer access, selector approval or production release.

An HTML file or M1 manifest may be a **regular file** with more than one
hard link. `lstat().isFile()` and SHA-256 alone do not establish exclusive
physical ownership of its bytes: another path (possibly outside the captured
tree) could be the same inode without any symlink. Such aliases can also
misrepresent separate historical inputs.

The comparator therefore accepts ordinary single-link regular HTML sources
and manifests (`nlink === 1`), and fails closed if either has a hard-link
count other than one. Manifest rejection occurs before reading it; capture
HTML rejection occurs in both current/historical preflight before the M1
inspector reads HTML. The operator CLI prints only its generic failure
message and no reviewer JSON on rejection.

This preserves the stricter 8 MiB **per-file and per-capture-tree**
resource budget, physical distinct-root/time chronology, nonsymlink
directory checks, integrity SHA, P1 unavailable/P2 no baseline/P3 independent
older source actions, and rights/selector/production/M5=false. It does not
prove filesystem snapshot atomicity, defend against all bind mounts or
concurrent privileged file swaps; a descriptor-pinned read design remains
a separate review decision.

Six new synthetic local real-CLI tests cover valid standalone P2 and valid
older independent P3, unavailable P1, HTML hardlink, manifest hardlink and
hardlinked historical HTML. Every fixture is `example.invalid` with invented
small bytes; inputs and hard links are unchanged after a rejected operation.
No independent QA tests, original parent, workflow, main or retailer evidence
is modified.

**Supa remains M3 ACTIVE.** Genuine same-demand 11 PLUS + 11 DekaMarkt
human observations within 24 h [#78](https://github.com/Zennay/Supa/issues/78)
are still outstanding; M4/M5 are not eligible. **DRAFT/HOLD/NO MERGE/NO
DEPLOY** pending source owner, independent QA, zCloud scope/task-write
preflight+lease, latest-main integration, trusted runner proof and explicit
human release authorization.