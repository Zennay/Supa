# SUPA printed shopping copy — printable label trust (13 October 2026)

**Current phase:** M3 ACTIVE. A real same-demand 11-line manual PLUS + DekaMarkt pair [#78](https://github.com/Zennay/Supa/issues/78) is still absent. Physical shopping print is convenience-only; it cannot establish trustworthy prices, retailer data permission or M3 savings.

## Scope and QA provenance
- Product repair of [#2079](https://github.com/Zennay/Supa/issues/2079), stacked independently on frozen original owner [DRAFT #2068](https://github.com/Zennay/Supa/pull/2068) exact `cdaadc2d7967a2662aee826bfc4e1c2ae705b249`.
- Original owner branch, frozen expected-RED [QA #2080](https://github.com/Zennay/Supa/pull/2080), existing other QA tests, `main`, workflows and actual store data untouched.
- Added `safePrintableLabel` to the isolated printer source: ignore C0/C1 control (Cc), Unicode formatting/bidi (Cf) and line/paragraph separators (Zl/Zp) before printing matched product, manual ingredient and store titles; trim and keep only visible labels. The method does **not** alter any source record or create new matching evidence.
- Visible accents and combining marks, emoji, hyphens and ordinary spaces survive as readable printed text. If there is no safe visible ingredient name, an unresolved/manual label is printed instead. Paper remains price-free.
- Five original independent [#2080](https://github.com/Zennay/Supa/pull/2080) test functions copied byte-for-byte into an add-only product replay file, plus two new tests for mixed-control stripping, fallback, immutability and privacy.

## Validate offline

```sh
node --experimental-strip-types --test tests/product-printable-shopping-checklist.test.mjs tests/product-printable-copy-bidi-postrepair-20261013.test.mjs tests/product-printable-copy-sanitized-20261013.test.mjs
npm test
npm run build
```

**No merge/deploy:** isolated staging candidate requires independent zCloud write lease, original product owner review, immutable full hosted CI, applicable permanent Firefox/VPS and printable/PDF human inspection, latest-main integration, and explicit human release decision. Synthetic tests are not real participant observations, supermarket access or savings evidence.
