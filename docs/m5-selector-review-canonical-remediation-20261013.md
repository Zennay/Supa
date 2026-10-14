# SUPA offline M5 selector-review queue — product remediation (13 Oct 2026)

## Current project gate
SUPA is **M3 ACTIVE**. Genuine 11+11 same-demand manual PLUS + DekaMarkt observations remain missing ([#78](https://github.com/Zennay/Supa/issues/78)). M4/M5 are *not* eligible. These are **offline synthetic safety improvements only**, not permission to scrape, deploy, auto-promote selectors or make savings claims.

## Scope and ownership
- Tracks the independent [QA issue #2128](https://github.com/Zennay/Supa/issues/2128) and read-only expected-RED [QA #2129](https://github.com/Zennay/Supa/pull/2129).
- Source parent: exact frozen product [#2126](https://github.com/Zennay/Supa/pull/2126) `53f52a8dcb65a751ff5701ac2cb79de8e28430a2`. Only this **new independent child branch** changes the queue source/tests; original product/QA source branches, `main`, workflows and stored observations remain untouched.
- Fix 1: reject invalid UTF-16 identifiers *before* tokenizing to SHA-256. Node's replacement UTF-8 encoding of two different lone surrogates is the identity hazard; SHA-256 itself remains unaffected.
- Fix 2: accept only canonical `captureShape()` snapshot provenance: verified captures have two valid 64-character lowercase hashes and `candidate_observation`/`abstain` schema status; unavailable captures have **both hashes null** and schema status `unknown`.
- Original owner fixture helpers now emit those upstream canonical states. Seven **byte-for-byte identical** original QA checks are replayed under a new product test path, plus four new boundary tests for valid non-BMP Unicode, malformed surrogate positions and provenance variants. The original immutable expected-RED QA #2129 is not edited.

## Reproduce without external requests

```sh
node --test tests/m5-selector-review-queue.test.mjs tests/m5-selector-review-cli.test.mjs tests/product-m5-selector-metadata-identity-postrepair-20261013.test.mjs tests/product-m5-selector-unicode-provenance-20261013.test.mjs
npm test
npm run build
```

Valid source records still create P1/P2/P3 manual actions with `selectorVerified=false`, `rightsVerified=false`, `productionReady=false`, `m5Eligible=false`. Invalid records throw generic messages without printing store IDs or paths; they do not become human review approvals. No retailer requests, actual price data, M3 human sample or live M5 eligibility are created.

**REVIEW HOLD / NO MERGE / NO DEPLOY:** independent zCloud scope/write lease and code owner consent; exact-head hosted CI plus applicable permanent VPS and Firefox; latest-main integration; explicit human release authorization. Treat regression-only success as source trust evidence, not phase completion.
