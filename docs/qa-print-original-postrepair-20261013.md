# Independent printable shopping copy postrepair QA — 13 October 2026

Source frozen at exact product [DRAFT #2137](https://github.com/Zennay/Supa/pull/2137) `afcdec7eb9e92c635295833645b5c7fcb6e2a226` on separate immutable QA base `qa/frozen-print-unicode-afcdec7e-20261013`. The new QA-only test `tests/qa-print-five-original-postrepair-20261013.test.mjs` is a **byte-for-byte original** of independent older expected-RED [#2080](https://github.com/Zennay/Supa/pull/2080), Git blob SHA `fa39f34e0e06b1e5a189e09316fd74d585dbf0e8`. No modifications to original product owner source/test, original QA file, any other worker's branch, shared main or CI workflows. Only new QA test+documentation.

Five original synthetic executable checks protect printed shopping names: two positives preserve Dutch/emoji text, unresolved/manual copies, source immutability and no invented money; three originally intended RED controls reject bidi/format/control characters in trusted product, store name and manual ingredient label. Their assertions are unchanged, so on corrected frozen product all five should pass *because of source remediation only*, not because of QA test modification.

A green hosted unit test is not a print rendering verification. Applicable future permanent Firefox/PDF print validation and user-visible behavior/contrast/layout remain separate release gates; also need independent zCloud preflight/write lease, original product/QA reviews, latest-main integration and explicit human authorization. No store scraping, no real observations, no M3 savings claims.

**Supa remains M3 ACTIVE; real [human PLUS+DekaMarkt same-demand 11+11 #78](https://github.com/Zennay/Supa/issues/78) OPEN. M4/M5 ineligible. DRAFT/HOLD/NO MERGE/NO DEPLOY.**
