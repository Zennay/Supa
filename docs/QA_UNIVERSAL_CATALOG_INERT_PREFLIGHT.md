# Private universal retailer catalog — independent QA preflight

This utility is an **offline QA-only review** of Supa's archived M1 PLUS and DekaMarkt product, catalog and offer evidence. It is not a retailer scraper, a source-data license, a user-facing price engine, a savings statement or a substitute for the public direct-catalog API's own input validation.

## Run the fixed six-source review

```bash
node --experimental-strip-types scripts/qa-universal-catalog-inert-preflight.mjs
node --experimental-strip-types --test tests/qa-private-universal-catalog-inert-preflight-20261016.test.mjs
```

The command opens **only** six reviewed, historical, bundled M1 source files. No parameters, external URLs, network capture, current prices, scrape credentials or product IDs are accepted or printed. Its JSON output consists of aggregate counts and explicit historical-only / no-live-price / denied-permission / no-public-savings flags. It exits unsuccessfully with a fixed refusal message on invalid caller arguments or evidence.

## Programmatic QA API

The standalone module exports:

- `pinInertPrivateCatalogInput(untrusted)`: construct a detached, frozen JSON data snapshot from only own data descriptors. It must refuse any getter, Proxy (including revoked Proxy), inherited/exotic prototype, symbol, cycle, sparse array, nonfinite number, undefined, function or oversized graph **before** evaluating caller-provided code. Boundaries: nesting depth 32, object/array nodes 50,000, at most 4,096 object keys and 16,384 array positions. Repeated references are legal when they are not **active cyclic ancestors**; each repeated occurrence is independently copied so later caller mutations cannot alter the pinned record.
- `reviewInertPrivateCatalogInput(untrusted)`: pin before invoking the existing private universal retailer catalog and emit *only* aggregate historical observations. It asserts no source rights, selected current price, published product, public financial claim or external requests.
- `main(argv, emit)`: accepts exactly zero inert CLI arguments, loads the fixed local fixtures and writes only the privacy-safe aggregate.

The seven-plus independent test groups exercise positive real historical fixtures, explicitly fictional hostile JavaScript records, shared reference isolation, Proto/getter/Proxy refusal without trap calls, bounded recursive input, CLI subprocess output privacy and refused external input. They do not require retailer HTTP or licensing.

## Deliberate separation from product correctness

The actual exported production candidate is `buildUniversalRetailerCatalog` from `scripts/retailer-universal-catalog.mjs`. This QA script **does not patch or wrap** that function for all callers. Direct calls on canonical main were independently proven unsafe by six targeted tests in [issue #3188](https://github.com/Zennay/Supa/issues/3188), original [QA PR #3187](https://github.com/Zennay/Supa/pull/3187), hosted run [38847314863](https://github.com/Zennay/Supa/actions/runs/38847314863).

Product-core owns actual source repair in [PR #3190](https://github.com/Zennay/Supa/pull/3190). The original six tests were replayed **byte-identically** on the frozen owner fix through [QA PR #3196](https://github.com/Zennay/Supa/pull/3196), run [38848482875](https://github.com/Zennay/Supa/actions/runs/38848482875), with all six changed from genuine RED to GREEN; separate six-source matrix review [QA PR #3197](https://github.com/Zennay/Supa/pull/3197) checks benign functionality. Do not close the product issue simply because this QA-only CLI runs successfully.

## Release restrictions

Written PLUS/Deka source rights [#74](https://github.com/Zennay/Supa/issues/74), a human genuine 11+11 same-demand basket in 24h [#78](https://github.com/Zennay/Supa/issues/78), authentic field collector SHA [#205](https://github.com/Zennay/Supa/issues/205), trusted permanent M3 VPS evidence [#2833](https://github.com/Zennay/Supa/issues/2833), and authorized zCloud scoped SQLite writer/main integration are all independent release gates. A passing hosted Node/build test is **not** live retailer permission, financial savings proof, a deploy, or M4 completion.
