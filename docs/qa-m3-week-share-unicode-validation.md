# M3 private selected-week copy — independent Unicode trust replay

Scope: **quality-validation 2/2**, independent of the product owner. Pure, fictitious in-memory menu titles; no actual supermarket requests, saved participant information, observed prices or public savings claims.

## Trust boundary / original defect
- Owner's frozen [#2359](https://github.com/Zennay/Supa/pull/2359) at `f6ee7b5108940552b23df731912aca7e24287392` accepted Unicode line separator U+2028, paragraph separator U+2029 and zero-width U+200B/200C/200D in shared day/recipe labels.
- [Issue #2360](https://github.com/Zennay/Supa/issues/2360) records expected security/privacy behavior. A fictional recipe name `Tikka\u2028Vr: Nepmenu` must be rejected before the copied text can display an extra menu line. Invisible-only titles or day IDs must also be rejected. Dutch diacritics must remain valid.
- Independent QA [#2361](https://github.com/Zennay/Supa/pull/2361): `tests/qa-m3-week-copy-unicode-original-red.test.mjs`; leave its original two negative assertions unchanged across owner-code fixes.
- **Original expected RED:** [GitHub Actions #38520038438](https://github.com/Zennay/Supa/actions/runs/38520038438), merged test against pre-fix owner `886e5f004ea5973a69a4e06ff9f1302928911261`, QA head `0ac2be195ef1531cb2ffdebb4a4fcf852bd9968c`, 679 total / 677 pass / exactly 2 intended RED. Other five independent cases GREEN, including private-by-default optional budget, cent exactness, empty week, stale/duplicate inputs, and readable diacritics. The RED run did **not** reach audit/M1/build.
- **Fix candidate:** owner source head `fd6f3257cbd54a6458d0bdaed2ff319be5589de8` replaces the ASCII-specific denylist with Unicode categories Cc/Cf/Zl/Zp and requires Unicode letter/number for visible label identity. QA is an independent read-only witness; the owner wrote this code.

## Acceptance and release truth
The same two original Unicode assertions must turn GREEN with the owner's frozen fix, while all full Node tests, npm high-audit, M1 matching/source-permission and TS/Vite build pass on the **exact tested GitHub Actions SHA**. Check applicable permanent browser/mobile runner separately; never infer it from hosted CI. Review the original product and QA source; verify zCloud SQLite task/scope write lease and explicit owner/human release authorization before any integration. Do not merge this QA-only draft or the product draft from this evidence alone.

Supa remains **M3 ACTIVE**. Genuine matching 11-item PLUS baseline and 11-item DekaMarkt candidate observation within 24 hours ([human field issue #78](https://github.com/Zennay/Supa/issues/78)) is still absent. This synthetic test proves neither real retailer data nor M4/M5 eligibility.
