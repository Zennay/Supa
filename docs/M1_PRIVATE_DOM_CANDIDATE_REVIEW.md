# M1 — private browser DOM candidate review (AH, Dirk, Hoogvliet, Jumbo)

This **offline-only** product-core handoff sits after the already isolated private capture and Firefox DOM candidate probe. It **does not** download pages, bypass a retailer denial, create price/offer mappings, approve a selector, or make a public savings claim. Supa remains in M3 pending the genuine human PLUS + DekaMarkt field issue [#78](https://github.com/Zennay/Supa/issues/78).

## Operator sequence (only after source/terms permission)

1. Use the existing approved opt-in registered-source capture tool, never a rotating proxy. Verify the private `capture-<timestamp>-<pid>.html` and matching `.json` in Git-ignored `artifacts/m1-multistore-research/<source-id>/`. A 403/429 remains a hard stop.
2. On the normally accessible corresponding **public HTTPS** retailer page, run `scripts/m1-dom-candidate-probe.js` in Firefox DevTools. Explicitly review what the browser reported. Its `rendered-dom-candidate-only` object has `originHost`, `capturedAt`, `selectors` and `actualClassCandidates`. Export only that **structural** object to a private local JSON file; no source text, cookie, account information, URL, price, product names or entire DOM.
3. Run this command locally (illustrative IDs/stems, not a claim of an actual capture):

```sh
node scripts/m1-dom-candidate-review.mjs --review dirk-halvarine capture-1791675600000-1234 artifacts/private-browser-probe.json
```

The tool rereads the private HTML+metadata pair through the existing source/size/SHA-256/timestamp audit, validates the independently observed browser DOM report against the **registered source's exact hostname**, caps each count and list, and refuses unrecognized selectors, duplicate selectors, accessor/proxy anomalies and extra fields that could contain raw content.

It writes a new **owner-only 0600** JSON into Git-ignored `artifacts/m1-dom-reviews/<source-id>/<stem>-candidate-review.json` with an exclusive create (no clobber). The private file contains candidate CSS selectors and observed structural counts for subsequent manual verification, **not** observed prices or verified product fields. CLI stdout contains *counts and status only*, never CSS strings or page content. Neither the probe nor capture tool sends reports to CI or any third party.

### Critical trust boundary

A browser-rendered DOM and a downloaded HTTP response are **separate observations**. Matching registered hostname plus passing integrity checks **does not** cryptographically establish that the selected CSS matched the saved HTML, was a real product name, valid euro price, pack unit, price context or authorized data source. The output explicitly retains:

```json
{
  "status": "human-semantic-review-required",
  "domCaptureIdentityVerified": false,
  "retailerPermissionVerified": false,
  "semanticVerified": false,
  "livePriceVerified": false,
  "publicSavingsClaimEligible": false
}
```

Only implement a retailer-specific adapter **after** separately establishing source permission and manually verifying exact selectors on genuine retained DOM evidence, with reviewed regression fixtures. No speculative name/price CSS selectors may be promoted into `src/data` or shopping/savings economics. Do not share private HTML/probe JSON/capture stem via GitHub, Notion, or automated artifact uploads.

Test locally or in hosted CI with **synthetic** fixtures only:

```sh
node --experimental-strip-types --test tests/m1-dom-candidate-review.test.mjs
```

Permanent runner validation and original multistore research owner acceptance remain required before any merge/deploy.
