# M5 manual-research evidence — non-public literal IP address acceptance

**Owner source:** original [DRAFT #2090](https://github.com/Zennay/Supa/pull/2090) at immutable `15e2a2bfdc31b8077b55cadea65c71d438da98fe`. Tracks [QA issue #2104](https://github.com/Zennay/Supa/issues/2104). Independent synthetic-only QA, no source edits.

Run `node --test tests/qa-m5-research-private-address-literals-red.test.mjs`.

## Contract

- **2 positive:** a fictional, canonical `https://example.invalid/` source/terms citation can be recorded as **unverified** local human research, and the real CLI with a mode-0600 disposable private file outputs only an 17-retailer blocked summary. Both input data and canonically curated discovery remain immutable; URLs never appear in the result.
- **5 intended RED:** the exported `assessRetailerResearch()` must reject literal `127.0.0.1` (loopback) and `10.0.0.7` (RFC1918) in an `official-feed` source URL, `192.168.1.10` (RFC1918) in a terms URL, and `169.254.169.254` (link-local) in a *claimed, unverified* permission-evidence URL. The real CLI must reject a loopback feed URL before emitting a research result, returning only generic non-sensitive diagnostics.

The frozen owner currently validates URL canonical HTTPS, no embedded credentials, port or fragment and excludes literal `localhost`, but allows private dotted-IPv4 hosts as human metadata because `new URL().hostname.includes('.')` accepts them. Owner may define a documented address-policy with a strict literal-IP denylist; **this module never issues network requests**, so this is source evidence provenance/validity only, **not a demonstrated SSRF or incident**. Public-domain DNS rebinding/resolution is out of scope; this is not a proxy probe or retailer download.

No private person, real retailer account, real pricing, source license, field receipt, API call, scraping or financial claim. Even a synthetic rights-evidence URL does not grant approval, and `productionReady=false`, `m5Eligible=false`, `rightsVerified=false` must remain invariant. True M3 [#78](https://github.com/Zennay/Supa/issues/78) PLUS+DekaMarkt same-demand 11+11 field data remain OPEN.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending product owner review, separate correction on authorized branch, independent zCloud claim/lease, corrected all-green exact-head hosted plus applicable permanent VPS, latest-main integration and explicit human release approval.
