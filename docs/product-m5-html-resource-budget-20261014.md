# Offline M5 capture HTML resource budget

**Target:** [#2165](https://github.com/Zennay/Supa/issues/2165).
**Parent:** frozen product symlink-proof [#2184](https://github.com/Zennay/Supa/pull/2184),
SHA `b1c8e1abfe5ff7a59213bc1125dd842e168d9c76`.
This is future **manual** source inspection preparation, **not** live
retailer scraping, new source permission, product release or observed savings.

A syntactically valid, SHA-correct M1 manifest previously allowed arbitrary
file sizes into canonical HTML inspection. A SHA-256 digest proves byte
identity, not a finite parser/heap/CPU bound. The M5-only local
`requireRegularCaptureTree` preflight now refuses any successful HTML
entry when its nonsymlink regular-file `lstat.size` is not a safe integer,
is larger than **8 MiB**, or makes the successful-source total in that
capture tree exceed **32 MiB**. Exactly 8 MiB is inclusive. This applies
independently to both current and historical reference capture trees,
before `inspectCaptureDirectory` calls `readFile`. Failed captures do
not require an HTML file and retain conservative P1 status.

The already enforced 8 MiB manifest size and 100-record ceilings, actual
SHA-256 verification, unique/source-origin review statuses, strict capture
chronology, independent physical capture roots, and root/manifest/store/HTML
non-symlink checks remain in place. CLI rejection still uses generic
non-leaking stderr and publishes no review JSON. All rights, selector,
production and M5 flags remain false. Aggregate cap is per capture
directory, not a promise of a high-security concurrent filesystem quota.

This guard is a **pre-read path-size check, not descriptor-bound atomic
reading**: privileged concurrent replacement or file growth between stat and
read remains possible. It is therefore deliberately not described as a
complete TOCTOU defense. The original [independent QA #2166](https://github.com/Zennay/Supa/pull/2166)
remains separately owned and must be replayed **without modifying its
original QA code** before any integration consideration.

Product-owned synthetic local regression tests: tiny valid P2, unavailable
P1 without source file, inclusive 8 MiB valid HTML, oversized current,
oversized historical, and five individually valid 7 MiB files exceeding
the aggregate 32 MiB ceiling. Test inputs are invented local bytes and
`example.invalid`; no network, supermarket identities, real personal
data or price calculations.

**Release HOLD:** Supa **M3 ACTIVE**. Genuine PLUS/DekaMarkt same-demand
11+11 within one 24h context [#78](https://github.com/Zennay/Supa/issues/78)
remains open; M4/M5 ineligible. No merge/deploy/public savings without
independently verified zCloud scope/task-write preflight+lease/claim,
source and QA owner signoff, applicable latest-main/VPS acceptance, human
field evidence and explicit releasego.
