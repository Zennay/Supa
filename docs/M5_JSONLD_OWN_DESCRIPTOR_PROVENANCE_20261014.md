# Future M5 — own JSON-LD data descriptors and stable snapshot fingerprints

Issue [#2304](https://github.com/Zennay/Supa/issues/2304), standalone product-core child of hosted-GREEN [#2296](https://github.com/Zennay/Supa/pull/2296) exact SHA `57ce76010cdc47046457cb6633932226d0f8e866`.

## Threat and narrow contract

Canonical M1 `inspectHtml()` emits arrays of ordinary JSON-LD summary records with own plain `type` and `keys` string arrays, plus optional own boolean `parseError: true`. The old future-M5 pure `captureShape()` dereferenced these properties and indexed arrays directly, so a forged accessor could execute private code or mutate a value between admission and fingerprint hashing.

The corrected validator takes **own data-property descriptors** for each JSON-LD record, each `type`/`keys` field, optional `parseError` (reject inherited/getter statuses) and each bounded array index. It copies their bounded string data once; both Product-candidate admission and digest generation use that same sanitized snapshot. Getter functions must never execute for these fields. Rejections use only `Invalid or unbounded inspected HTML shape`, no source values. Existing 128 record / 256 entry caps remain unchanged; `@graph`, direct Product, parse errors and failed sources retain canonical behavior.

The new fictional test suite covers own vs inherited/getter metadata, hostile numeric-index getters, sparse arrays, malformed `parseError`, 128 records and 256 terms, genuine `inspectHtml()` success/failure, manual-only P2/P3 queue flags, privacy and input immutability. This protection is limited to the JSON-LD descriptor provenance and does not promise Proxy-trap resistance, complete source authenticity, real retailer rights or proof of prices.

## Release boundary

Supa remains **M3 ACTIVE**; authentic human [#78](https://github.com/Zennay/Supa/issues/78) same-demand 11 PLUS + 11 DekaMarkt observations in one price context within 24 h are missing, so M4/M5 remain ineligible. This is entirely offline/fake, **DRAFT/HOLD/NO MERGE/NO DEPLOY**, pending independently verified zCloud SQLite write/task lease, original source and QA owner approval, exact hosted full CI, current-main/trusted runner as applicable, actual field observations/source rights and explicit human releasego. Independent QA #2297/#2298/#2299 branches and separate product #2301 remain untouched.
