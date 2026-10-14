# M5 future offline manifest: bounded descriptor streaming

**Frozen parent:** [product DRAFT #2202](https://github.com/Zennay/Supa/pull/2202),
exact `f9f3d05f978822d6f0742f232c9d403be39293b0`.
**Scope:** local human-only reviewer preparation, no active retailer
capture or M5 rollout.

## Why replace a whole-file read

The earlier M5 raw manifest preflight used a stable open descriptor
with `O_RDONLY|O_NOFOLLOW`, validated `fstat().size <= 8MiB`, then
used `FileHandle.readFile('utf8')`, rejecting any decoded bytes larger
than 8MiB **after** the full read. A source which grows during the
read could therefore allocate more than the nominal budget before
the size rejection. The new small `readBoundedManifest(handle)`
reads at most 64KiB each time **from that same descriptor** and
stops as soon as a ninth MiB would be entered: the maximum observed
source byte budget is exactly **8 MiB + 1 byte**. It assembles and
parses JSON only if within 8 MiB inclusive.

The existing guarantees stay: both nominated roots are checked
before reading any manifests; descriptor stat enforces regular,
single-link files; UTF-8 decoding occurs only after raw-byte size
admission; canonical raw source IDs, source origins and Boolean
successes are validated before HTML; the full current+historical
cohort is structurally validated before HTML inspection; SHA checks,
physical root/HTML ownership, capture chronology, P1/P2/P3 private
manual review and rights/selector/production/M5=false stay intact.

Seven new product-owned synthetic checks cover short multibyte
UTF-8, exactly 8MiB bytes, a deterministic 16MiB fake growing
descriptor stopped at byte 8MiB+1, empty read, exact-limit M1
manifest P1, oversize current and oversize historical manifests.
No retailer URLs beyond `example.invalid`, no customer data,
prices, external calls or savings. Input files remain intact.

**Limitations:** bounding the manifest *preflight* descriptor does
not make the canonical M1 inspector's **later independent reread
of the manifest and HTML source files** atomic or bounded by the
same descriptor, nor does it defeat privileged concurrent
filesystem swapping or bind mounts. This is deliberately not
claimed as full race-free provenance or production readiness.

**Supa M3 ACTIVE:** the first real same-demand PLUS 11 and DekaMarkt
11 observations within one 24h price context
[field #78](https://github.com/Zennay/Supa/issues/78) remain OPEN.
M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** absent
independent source and QA owner review, zCloud SQLite
scope/claim/write lease proof, latest-main and applicable
trusted permanent runner evidence, genuine field data and
explicit human release authorization.
