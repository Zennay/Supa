# SUPA future M5 — never mix failed JSON-LD parsing with successful parsed keys (14 October 2026)

## Verified source contract
The real canonical M1 `inspectHtml()` appends `{type:[], keys:[], parseError:true}` to the inspection whenever JSON-LD parsing fails. A malformed JSON script cannot also supply a parsed `Product` type, `offers` or other keys. The upstream pure future-M5 `requireBoundedHtmlShape()` previously enforced `parseError` true-or-absent but allowed nonempty type/key arrays next to `parseError:true`. This accepted a fabricated contradictory shape as ordinary future human review evidence.

## Narrow correction
Frozen parent previously hosted-green [product DRAFT #2274](https://github.com/Zennay/Supa/pull/2274), exact immutable `1a623c7c9a5525c5cd349f61959d62b8964b4c31` (999/999 PASS); new independent child product-core [issue #2275](https://github.com/Zennay/Supa/issues/2275).

The pure M5 shape admission now rejects any record with `parseError === true` unless **both `type` and `keys` are length-zero arrays**. Other canonical boundaries (own dense arrays, at most 128 JSON-LD blocks, at most 256 key/type items of at most 256 UTF-16 code units each, safe script resource cap 8 MiB and strict boolean/scalar preflight) remain intact. The existing fixed, source-independent `Invalid or unbounded inspected HTML shape` error is reused. Good parsed Product type/keys without parseError, genuine malformed JSON-LD parser results, distinct SHA verified source changes and normal human P1/P2/P3 are unaffected.

## Acceptance
Standalone `tests/product-m5-jsonld-parse-error-20261014.test.mjs` contains twelve fictional synthetic/real M1 inspector controls for forged type, forged key, mixed type/key alongside error, valid true-and-empty parse error, legitimate type/key record, absent parseError, invalid false/string/array markers, missing or sparse type/key arrays, failure before a comparison/queue, genuine `inspectHtml` malformed HTML → P3, genuinely changed HTML and parsed Product → P1, two actual parse failures. No network, retailer data or real prices. Existing independent QA branches and earlier product owner branches are not modified. Test all Node suites, high npm audit, M1 matching and source-permission gates, TypeScript/Vite build on exact final head.

## Hard release boundaries
**Supa M3 ACTIVE.** Genuine human [#78](https://github.com/Zennay/Supa/issues/78) PLUS 11 + DekaMarkt 11 same-demand basket comparison in one 24h context has not happened; M4 and M5 are ineligible. No new selectors, price ingestion, source rights, savings claims, beta, main merge or deployment. This branch remains **DRAFT/HOLD/NO MERGE/NO DEPLOY** until verified independent zCloud SQLite scope/task write claim+lease, original source+QA owner reviews, exact CI, latest-main/trusted runner as needed, real human M3 field evidence and explicit releasego.
