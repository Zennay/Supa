# SUPA owned HTTPS proxy echo — DNS-only admission

The optional **operator-owned** HTTPS echo is an offline health diagnostic for the candidate proxy module. It is **not** a retailer capture target and provides no permission to scrape stores.

`validatedOwnedEndpoint(rawUrl, ownedHost)` requires a canonical ASCII DNS hostname under explicitly owned control. A raw IPv4 or IPv6 address is **never** a valid owned echo, even when `ownedHost` repeats that same address. The validator checks the WHATWG-parsed hostname because Node normalizes compact, octal and hexadecimal IPv4 shortcuts to canonical IP addresses. It also rejects noncanonical DNS labels, empty/trailing labels and numeric top-level labels, plus the existing HTTP downgrade, custom ports, credentials, query/fragment, reserved local/test names and hostname mismatch.

The checks are **pure**. They do not resolve DNS, prove domain ownership or block DNS rebinding by themselves; HTTPS certificate/host verification and human-controlled reverse-proxy configuration remain mandatory before an operator can test an owned endpoint. A matching DNS name is a prerequisite, not a grant for an external probe.

## Offline regression

```bash
node --test tests/product-proxy-owned-public-dns-only-20261016.test.mjs
```

The tests cover positive canonical DNS names and 18 IP/numeric variants, including localhost, RFC1918, link-local/metadata, public raw addresses, IPv6, shorthand, octal, hexadecimal, decimal and trailing-dot forms. An additional `runCycle` regression injects fictional candidate/probe functions and proves a metadata-IP target is rejected **before** either function or the local private state storage is touched. No feed, network transport, CONNECT, DNS or supermarket request occurs in the tests. Independently replay the original unchanged [QA #3275](https://github.com/Zennay/Supa/pull/3275) IP-literal RED checks against the fixed product source.

## Release remains disabled

This source patch is stacked separately on [parent #3269](https://github.com/Zennay/Supa/pull/3269), never inserted into that active owner's branch. **Do not enable the timer/proxy on VPS**, rotate around retailer anti-bot limits or publish current retailer prices without separate operator approval, configured real owned HTTPS echo, source rights [#74](https://github.com/Zennay/Supa/issues/74), real M3 observation [#78](https://github.com/Zennay/Supa/issues/78), field source SHA [#205](https://github.com/Zennay/Supa/issues/205), permanent CI/VPS [#2833](https://github.com/Zennay/Supa/issues/2833), scoped writer lease and review.
