# Offline M5 manifest source-identity uniqueness

**Issue:** [#2197](https://github.com/Zennay/Supa/issues/2197) ·
**frozen parent:** product [#2195](https://github.com/Zennay/Supa/pull/2195)
`f44a77d67c906e72b80fd132044bc599735a3333`.

## Why this is a separate offline product guard

The future-M5 local manual reviewer must never inspect successful-source
HTML for a capture manifest which cannot define a unique source identity.
The downstream `compareInspections()` already rejected duplicate IDs,
but historically that happened **after** the M1 inspector had read
successful-source HTML. A duplicated source entry should fail at bounded
manifest preflight, before any HTML filesystem I/O, and on **both current
and historical** capture manifests.

The change adds one manifest-level `Set` of raw source IDs, with the same
canonical safe-segment grammar as the M1 inspector. Every row, including an
unavailable/P1 row, must have a unique ID in its own manifest. It does not
require different IDs *across* snapshots: a genuine newer/current and
older/baseline observation must share its canonical source ID for a valid
private P3 comparison. Failing either manifest prevents all report JSON
and preserves the existing generic CLI stderr.

The existing limits remain: 8 MiB total HTML and 8 MiB per source,
bounded manifest length/count, SHA-256 actual-content check, real
regular nonsymlink/single-link manifest and HTML, independent physical
roots, capturedAt UTC chronology, P1/P2/P3 human-only classification,
and rights/verified selectors/production/M5=false. A valid candidate
does not confer retailer permission or public savings.

Seven new product-owned local synthetic tests exercise distinct P2,
shared source ID across independent P3, duplicate successful-ID
refusal **before missing HTML**, duplicate P1 record refusal, historical
duplicate refusal before current HTML, cross-store same-ID refusal, and
unsafe source ID refusal before a path could be opened. Files are
invented `example.invalid` fixtures, never actual retailer data.
Independent QA and original parent source remain unchanged.

This manifest-only preflight is **not** a race-free descriptor-pinned
filesystem snapshot; following M1 reads can still encounter concurrent
privileged mutations, and this documentation claims no total TOCTOU
hardening.

**DRAFT/HOLD/NO MERGE/NO DEPLOY.** Supa remains M3 ACTIVE: first
human same-demand PLUS 11 + DekaMarkt 11 within one 24h price context
[issue #78](https://github.com/Zennay/Supa/issues/78) remains OPEN.
M4/M5 ineligible until independent zCloud SQLite scope/task-write
claim+lease, original source/QA owner reviews, current-main and trusted
runner validation, genuine field observations and explicit human releasego.
