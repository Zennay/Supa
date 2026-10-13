# SUPA M3 — independent original QA source replay on latest composed source

**Review-only frozen product source**: [DRAFT #2115](https://github.com/Zennay/Supa/pull/2115) at exact commit `682dffbf5b02e00b880a6d40d1f599b6cedac111` (contains independently owned M3 privacy/observed-week and M4 candidate changes). This is **QA-only**: the underlying products, original QA test suites, original owner branches and canonical `main` have not been edited.

## Unmodified evidence acceptance contracts

- Six original test cases from [DRAFT #2094](https://github.com/Zennay/Supa/pull/2094), [issue #2093](https://github.com/Zennay/Supa/issues/2093), Git blob `fa8742c710ba07dc5ef8ac94de246a57b462f9b9`, byte-for-byte copied to `tests/qa-m3-weekstart-on-current-composed-source.test.mjs`. Two valid same-week cases remain positive; two invalid past/future week direct domain and two real CLI cases must now conservatively abstain from false savings. No assertions altered.
- Fourteen original test cases from [DRAFT #2096](https://github.com/Zennay/Supa/pull/2096), [issue #2095](https://github.com/Zennay/Supa/issues/2095), Git blob `800a4e48e3a1ce777906bfb9fcd842bbde600d6`, byte-for-byte copied to `tests/qa-m3-private-identity-on-current-composed-source.test.mjs`. Two safe positive controls plus twelve direct-module/real-CLI identity echo attempts must fail closed. No assertions altered.
- **Acceptance goal: all 20 original M3 QA checks green** against latest corrected product code; source/output bytes preserved on rejected cases, private identifiers never serialized in report or diagnostics. Retain unknown/null outcomes and `publicSavingsClaimEligible=false` without false claims.

Full exact-commit hosted CI should prove `npm ci`, high npm audit, all repo tests, M1 benchmark, source-permission gate and production TypeScript/Vite build; applicable permanent runner evidence and owner/lease signoff remain separate.

## Hard proof boundary

All input is fictional, with 11+11 invented canonical PLUS/DekaMarkt lines solely as test fixtures. Genuine [M3 field observation #78](https://github.com/Zennay/Supa/issues/78) still OPEN. No real price collection or retailer access, consent, personal information, student beta, public savings claim or M4/M5 eligibility. **DRAFT / HOLD / NO MERGE / NO DEPLOY**, pending zCloud write-preflight/claim/lease, source owners' review, current-main composition, permanent runner validation and explicit human authorization. This is a frozen QA review, not a release vehicle.
