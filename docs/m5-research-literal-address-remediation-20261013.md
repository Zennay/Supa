# SUPA M5 offline human-research URLs: reject literal network endpoints

**State:** M3 active; genuine manual [PLUS + DekaMarkt 11+11 basket #78](https://github.com/Zennay/Supa/issues/78) still open, no permission or evidence supporting M4/M5 release.

## Provenance and independent ownership

- Narrow product-core remediation for [QA #2104](https://github.com/Zennay/Supa/issues/2104).
- Stacked independently on original human-research owner [Draft #2090](https://github.com/Zennay/Supa/pull/2090), exact parent SHA `5d8ae48e4df6a5da12c23e9b6750b0ddbfd9ee2f`; original owner source branch, frozen [expected-RED QA #2105](https://github.com/Zennay/Supa/pull/2105), `main`, workflows, participants and retailer sources untouched.
- The independent original **seven QA test cases are copied byte-for-byte** into a *new* product replay path, plus two new regression cases with 13 literal/local host variations and public-style fictional positive controls.
- `validHttps` rejects all numeric IPv4/IPv6 hosts (public and private) and `localhost` aliases before recording manual evidence flags; Node's WHATWG `URL` canonicalizes dotted, integer and hex IPv4 forms first. No DNS resolution, browser fetch or HTTP request is performed.
- A public-looking hostname still is **not proof of public reachability**, consent, retailer rights or trust. DNS rebinding and externally observed retailer provenance are beyond this pure offline validator.

## Offline validation

```sh
node --test tests/m5-retailer-research-review.test.mjs tests/product-m5-research-private-address-replay-20261013.test.mjs tests/product-m5-research-canonical-hosts-20261013.test.mjs
npm test
npm run build
```

Private research returns only completeness/disabled source flags, not URLs, and keeps `rightsVerified=false`, `productionReady=false`, `m5Eligible=false`. Failures remain generic without private filename/URL in CLI stderr, and never generate a public research-report success.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** until independent zCloud preflight/write lease, original owner review, exact corrected-head hosted CI and applicable permanent VPS/browser, latest-main integration, and explicit human authorization. No M5 rollout or production retailer activity is authorized.
