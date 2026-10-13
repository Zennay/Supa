# SUPA independent QA — printable copy and Unicode visual trust

**Status:** EXPECTED RED / DRAFT / HOLD / NO MERGE / NO DEPLOY.

Frozen product owner [PR #2068](https://github.com/Zennay/Supa/pull/2068) source commit: `6b5a344f57f51f4e61370eadd8493d54e9137406`, reference branch `qa/frozen-print-labels-6b5a34-20261013`. Original product-core and previous QA owner branches remain untouched. [Issue #2079](https://github.com/Zennay/Supa/issues/2079).

## Concrete trust boundary

`visibleText()` strips Unicode format/marks **only to test whether visible text exists**, but `preparePrintableShoppingChecklist()` returns the raw original `.trim()` label if it passes. A product or store field with visible letters plus embedded bidirectional overrides, isolate markers, zero-width space, U+2028/U+2029 separators, embedded newline/tab or NUL can therefore appear unchanged on paper. This can spoof product order/identity or split printed rows without a real ingredient change. It is a **synthetic test input** and not an observed adversarial retailer feed.

## Executable matrix

`tests/qa-printable-visible-copy-control-boundary.test.mjs` uses the exported product function and canonical fictional M2 basket. Two green controls preserve legitimate Dutch accent marks, emoji, dashes, manual unknowns and price-free output. Three **expected-RED** suites exercise seven unsafe-character families in:

- a matched product name (allow explicit manual abstention or sanitized trusted text, never raw control characters in trusted copy);
- the store heading (never raw control characters in paper title);
- an unresolved ingredient's fallback name (never visually spoofed manual label).

Each trial verifies source immutability, no dropped lines, preserved ordering, consistent review count and no exported money or participant fields. Avoid blindly removing legitimate zero-width joiners used inside emoji; target display-control/override semantics precisely.

## Corrective owner contract

Product owner should review whether to abstain/manual or remove specifically dangerous controls for each copy surface. Keep source IDs/evidence unchanged, avoid Unicode normalization that merges distinct verified products, preserve legitimate accents and emoji, add final-head hosted CI and actual Firefox WebDriver PDF textual/visual checks on corrected head, and obtain permanent VPS, owner/route and zCloud integration approval.

No retailer network access, public financial claims, real participant data, M3 completion or M4 beta is asserted here. Genuine M3 PLUS+DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) remains open.
