# M5 offline capture-tree local ownership — product boundary

**Target issue:** [#2168](https://github.com/Zennay/Supa/issues/2168).
**Scope:** future offline manual source-review queue only, not live scraping,
M1 acquisition, M3 real savings or M5 authorization. New product-core child
of frozen hosted-green [#2183](https://github.com/Zennay/Supa/pull/2183).

After *both* bounded manifests pass the original structural checks, and
**before any successful-source HTML is read**, the offline M5 comparator
requires the nominated capture directory, every successful source supermarket
directory, and the final HTML source to be regular **non-symlink** filesystem
objects. Root `realpath` must equal the lexically resolved nominated root,
so directory-symlink aliases (including aliases in the ancestor path) cannot
borrow an outside tree. The manifest itself is opened only after its `lstat`
reports a regular nonsymlink file. Every row is checked in both the current
and historical capture trees, rather than only the first row.

Failures use the existing generic CLI stderr and withhold JSON reviewer
actions. Canonical failed M1 captures require no HTML file and remain
P1/unavailable. Regular SHA-verified captures remain P2 for no historical
baseline, or private P3 only for an independent strictly older physical root.
No rights, verified selectors, production, M5 or savings are enabled.

These are local path and metadata preflights; they **do not** guarantee
descriptor-pinned race-free I/O under concurrent privileged filesystem
mutation. Per-HTML and aggregate source byte budgets remain a separate issue
[#2165](https://github.com/Zennay/Supa/issues/2165), which is not silently
declared done here.

Seven new **product-owned** tests use invented tiny SHA-correct local HTML:
regular P2, failed P1, root/manifest/store/final-HTML symlink rejection,
and historical source-file symlink rejection. Independent [QA #2169](https://github.com/Zennay/Supa/pull/2169)
owns eight separate original immutable expected-RED cases for replay; those
files are neither copied nor modified in this source branch.

**HOLD:** Supa M3 active and [human 11+11 PLUS+DekaMarkt #78](https://github.com/Zennay/Supa/issues/78)
open. No public financial claim, permission grant, M4/M5 run, merge or
deployment before reviewed independent QA, zCloud SQLite scope/task
preflight+lease/claim, source-owner approval, latest-main + applicable
trusted VPS evidence, and explicit human release go.
