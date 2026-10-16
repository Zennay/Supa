# SUPA proxy health: exported direct-probe trust boundary

The private proxy health module exposes both `runCycle` and `probeViaOwnedHttps`. `runCycle` previously checked the user-provided owned HTTPS echo first, but callers could invoke the exported probe directly with a raw `URL` and bypass hostname/IP admission.

**Product fix:** the exported probe independently extracts a **native URL** by using `URL.prototype.toString.call(endpoint)`, reconstructs and passes the canonical URL through the same `validatedOwnedEndpoint` gate before handling the candidate or touching `http.request`. This refuses loopback, cloud metadata/link-local, RFC1918, public naked IPv4/IPv6, malformed/reserved DNS, non-HTTPS, non-443, token-bearing URLs and spoofed URL-shaped objects. Once checked, only the freshly validated URL is used to build CONNECT/TLS/Host and nonce request paths. No unvalidated caller object fields are reused for network destinations.

Run synthetic tests (the HTTP request is mocked **before** every direct call and cannot actually reach the network):

```bash
node --test tests/product-proxy-direct-probe-owned-admission-20261016.test.mjs
```

These checks are not actual DNS ownership verification or a defense against dishonest DNS records/rebinding by themselves. TLS CA/certificate validation and explicit operator-owned destination policy still apply, and a successful proxy health test is **not** permission for retailer scraping. Frozen independent [QA #3311](https://github.com/Zennay/Supa/pull/3311) three demonstrated RED must be replayed byte-for-byte against the fixed product SHA (without weakening the test source).

Review/integrate only in order: original owned echo [#3269](https://github.com/Zennay/Supa/pull/3269), DNS-only admission [#3307](https://github.com/Zennay/Supa/pull/3307), this direct-probe child, then independent QA and authorized scoped main writer/reviewer/VPS gates. Written retailer rights #74, actual same-basket M3 collection #78, field SHA #205 and permanent trusted runner #2833 are still required. **No live proxy endpoint, provider feed, retailer HTTP, deployment or public pricing is enabled.**
