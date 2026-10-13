# M3 private-report metadata: direct email identifiers (product-core)

Tracker: [#2095](https://github.com/Zennay/Supa/issues/2095). This is **synthetic source hardening** before genuine M3 field collection, not proof of a real privacy leak, observed PLUS/DekaMarkt prices, or a public savings claim.

## Policy

The M3 JSON assessment includes free-form `population`, `region` and both basket store display names/IDs. These fields must be usable for technical evidence summaries, but they must never quietly carry an email address into the derived JSON. On direct email-like contact identifiers (`local@domain.tld`), `buildObservedWeekReport` rejects the study **before** constructing the report; an actual CLI call with `--output` exits nonzero and leaves the absent target file absent. Errors identify the offending **field only**, without echoing the submitted address. Raw source evidence remains untouched.

Unknown, valid, generic descriptions are kept intact. `participantKey` stays omitted from the report; `publicSavingsClaimEligible` stays false independently of the validation outcome. The guard is deliberately bounded to email-like identifiers in the six report fields, **not** a guarantee of comprehensive automatic personal-data detection. Researchers must still minimize sensitive data in all free-form evidence, restrict raw files and review outputs.

## Verification

`node --experimental-strip-types --test tests/m3-product-private-metadata-guard.test.mjs` covers 14 synthetic cases: 2 positive report/CLI controls and 12 negative direct+real-CLI cases for population, region, both store names and both store IDs. Independent QA [#2096](https://github.com/Zennay/Supa/pull/2096) remains a separate frozen QA artifact; it must be replayed on corrected product source by its owner.

## Release gates

M3 human same-demand 11+11 observed PLUS and DekaMarkt [#78](https://github.com/Zennay/Supa/issues/78) is still OPEN. M4/M5 are not eligible. This candidate stays **DRAFT / HOLD / NO MERGE / NO DEPLOY** until independent zCloud claim/lease/preflight, owner approval, all-GREEN exact-head hosted and applicable permanent VPS validation, current-main integration and explicit human release authorization.
