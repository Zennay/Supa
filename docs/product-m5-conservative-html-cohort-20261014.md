# Product M5 offline cohort: conservative 8 MiB aggregate contract

**Issue:** [#2165](https://github.com/Zennay/Supa/issues/2165)
**Context:** Independent [QA #2187](https://github.com/Zennay/Supa/pull/2187)
replayed original immutable [QA #2166](https://github.com/Zennay/Supa/pull/2166)
and found one precise RED on the earlier [product #2185](https://github.com/Zennay/Supa/pull/2185):
**two source files of approximately 5 MiB each** were individually allowed
under the 8 MiB/file budget while exceeding the agreed QA **8 MiB total**.

## Conservative resolution

This child branch freezes the prior product owner #2185 SHA
`c14c2a3ce5de3500cc5dcd9488b180ccb55ad762` and changes **only** the
M5 local offline comparison resource policy. The single HTML input ceiling
remains **8 MiB inclusive**, but the complete successful-source HTML cohort
is now also **8 MiB inclusive per nominated capture directory**. Both
current and historical directories are subject to the same ceiling *before*
canonical M1 HTML inspection. A failed M1 observation remains unavailable/P1
without HTML and consumes no HTML bytes.

This matches the stricter original independent QA acceptance and reduces
worst-case local HTML parser input. The separate 8 MiB manifest bound and
100-source maximum, non-symlink roots/HTML, distinct physical historical
baseline, timestamp chronology, SHA integrity, origin drift, private CLI
errors and manual-only rights/selector/production/M5=false boundaries remain
in effect.

This is a pre-read size-policy check, **not** an atomic descriptor-pinned
read or protection against concurrent file replacement/growth. No production,
real retailer rights, selector approval, M5 launch or savings evidence
follows from these synthetic offline checks.

## Product-side evidence

New separate product tests cover exactly 3 MiB + 5 MiB (P2), 5 MiB + 5 MiB
refusal, baseline-side 10 MiB refusal with a safe current root, and 8 MiB
success beside an unavailable P1 source. **Do not modify** the original QA
files from #2166 or QA replay #2187: its six original controls must be
replayed byte-identically by the quality owner on the corrected source.

**Release HOLD:** Supa M3 active; genuine observed PLUS and DekaMarkt
same-demand 11+11 within 24 hours [#78](https://github.com/Zennay/Supa/issues/78)
not yet collected. M4/M5 ineligible. No merge/deploy until original owner,
independent QA, zCloud write claim/lease, current-main composition, applicable
trusted permanent VPS and explicit human releasego.
