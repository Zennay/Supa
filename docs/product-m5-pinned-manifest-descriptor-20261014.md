# Future-M5 offline manifest inode-pinned inspection

**Parent:** product [#2198](https://github.com/Zennay/Supa/pull/2198)
frozen exact `fbbf7e09a1c299fc8ac4d9bb009a5955c7cdb2fd`.
Related physical capture provenance issues: [#2168](https://github.com/Zennay/Supa/issues/2168),
[#2191](https://github.com/Zennay/Supa/issues/2191).

## Narrow file-handle safety improvement

The earlier offline comparator's manifest preflight ran
`lstat(manifest.json)` and then `readFile(manifest.json)`, thereby
checking one *path* before a second path-based open that could, under
concurrent file replacement, refer to a different inode. This child
uses an **opened read-only descriptor** with
`O_RDONLY | O_NOFOLLOW`, `FileHandle.stat()`, the actual
`FileHandle.readFile('utf8')`, and `finally close()` instead.
The original per-manifest 8MiB size limit, single-link non-symlink
regular-file rule, bounded source count, strict Boolean successes and
unique canonical source IDs still apply. After reading it rechecks the
**actual UTF-8 byte count**, so an already-open file which grows
cannot silently yield an unbounded accepted JSON result.

The same procedure is applied separately to current and historical
manifest inputs; on failure the existing reviewer CLI emits generic
stderr and no JSON reviewer queue. Tiny synthetic tests prove
ordinary P2, independent older P3, current and historical symbolic
manifest link refusal, and both sides' hard-link refusal. Inputs
remain intact; no retailer access, prices, participant files, network
or actual savings measurements are used.

**Security boundary:** This pins the M5 *manifest* read to the file
descriptor and closes the separate-check-then-open path-swap gap at
that step. It is **not** proof of full race-free capture ingestion:
root/ancestor checks and later M1 inspector source HTML/manifest
rereads remain independent operations, and concurrent privileged
mutation or bind mounts require another design/review. `O_NOFOLLOW`
covers the final manifest path component; ancestor aliases are
separately rejected by prior canonical-root preflight. No claims
of production-grade filesystem attestation or M5 permission.

**Status:** Supa M3 ACTIVE. Genuine same-demand 11 PLUS and
11 DekaMarkt observations within 24h [field issue #78](https://github.com/Zennay/Supa/issues/78)
not yet collected. M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/
NO DEPLOY** until original source and independent QA owners,
zCloud SQLite scope/task-write claim+lease, current-main and applicable
trusted VPS integration, real M3 field acceptance and human releasego.
