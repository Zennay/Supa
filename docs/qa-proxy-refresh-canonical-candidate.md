# Independent proxy-pool URL integrity QA (Supa #2081)

**State:** expected RED / DRAFT / HOLD / NO MERGE / NO DEPLOY.

Frozen source parent is [#2070](https://github.com/Zennay/Supa/pull/2070) at `6de0e4f3754b48c27d080b8690e3c2b127a3ab5f`. This QA PR is an isolated child of `qa/frozen-proxy-pool-6de0e4-20261013`, not a modification of the author branch, production code or main.

## Problem

`parseProxyCandidates()` appropriately treats its input as a multiline **untrusted feed**, trimming rows and ignoring invalid rows. `ProxyHealthPool.refresh()` mistakenly applies that **extractor** to one claimed endpoint and only verifies that one valid row was extractable. It then stores/returns the original full string rather than the extracted canonical candidate. Thus `http://8.8.8.8:8080\nnot-an-endpoint`, a private line appended to a public address, or trailing whitespace may be admitted as a health-pool key. A later owned-endpoint health flag could return this raw malformed string to a future caller.

## Synthetic executable acceptance

`tests/qa-proxy-pool-canonical-candidate.test.mjs` directly exercises the actual source export with no network:

- **GREEN**: multiline **feed parsing** may continue to ignore invalid rows, duplicates and private IPs.
- **GREEN**: a canonical `http://public IPv4:port` inventory entry is untrusted until an explicitly owned-HTTPS-echo probe result is supplied.
- **EXPECTED RED**: refresh rejects a purported single URL carrying an embedded invalid/ignored second row.
- **EXPECTED RED**: refresh rejects trailing tab/space/carriage return rather than returning it from `select()`.
- **EXPECTED RED**: a valid public address followed by a private localhost row must not enter inventory.

Keep the parser and health-pool contracts separate. Owner repair should compare each purported **single endpoint** against one validated canonical result, or parse via an anchored strict URL grammar with no extra whitespace/control. Ensure caller's actual network health probes are separately restricted to owned HTTPS echo endpoints; this suite does not test live network or production routing.

No proxy downloads, external echo checks, retailer requests, credentials or user information. A green fixture is not permission to scrape, evade rate limits, rotate bans or bypass source policy. All source activation and deployment remain gated by #2069 and current M3 #78.
