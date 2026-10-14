# Supa M4 private summary direct-identifier QA — issue #2084

**Phase:** M3 active; real human [PLUS+DekaMarkt #78](https://github.com/Zennay/Supa/issues/78) OPEN. **M4 INELIGIBLE; DRAFT / HOLD / NO MERGE / NO DEPLOY.**

## Independent observed code risk

On canonical frozen `main=c36f5c8f71d77cae94663978b51a194e9b183af6`, `scripts/m4-validate-beta-session.mjs` validates free-form `sessionId` and `population` with nonempty-string checks only. `buildBetaSessionSummary()` then serializes `sessionId: session.sessionId` and `population: session.population` unchanged. An email-like participant identifier embedded in either field can appear in the private report even while `participantKeyIncluded:false`; this Boolean by itself is not a privacy control.

## Executable QA (test-only independent lane)

New `tests/m4-direct-identifier-summary-qa.test.mjs` calls the real M4 exports with a **fictional abandoned session** and an artificial `m3Gate.status='closed'` fixture solely to exercise the code path. The test does NOT evidence a completed M3 and must not authorize beta recruitment.

Three positive cases should remain GREEN:
- Opaque session key plus benign cohort label yields private, not public-claimable output and excludes the participant pseudonym.
- An OPEN M3 gate still prevents any M4 input from being accepted.
- The real `main([session.json, '--output', report.json])` file workflow writes safe opaque metadata while excluding pseudonyms and never suggesting public claims.

Four direct-summary and two actual-file-output **expected-RED** cases require rejecting a synthetic direct email-like identifier carried inside `sessionId` or `population`, including obvious newline/assignment formats. Both exported summary and actual CLI output must reject invalid metadata **before writing**; rejected reports must not exist on disk. Do not mask or substitute personal data while silently claiming it came from the original source. Reject invalid metadata before report creation.

## Original source-owner contract

- Define strict pseudonymous session ID semantics (do not allow direct email, phone/contact strings or newline-assignment formats). Preserve safe opaque keys.
- Restrict cohort metadata to approved generic population labels or otherwise prohibit direct identities before serializing.
- Preserve `participantKeyIncluded:false`, `publicClaimEligible:false`, and M3 gate validation.
- Independently coordinate [M4 timestamp owner #151](https://github.com/Zennay/Supa/pull/151), [integer QA #2049](https://github.com/Zennay/Supa/issues/2049), [temporal QA #2073](https://github.com/Zennay/Supa/issues/2073) and [basket QA #2075](https://github.com/Zennay/Supa/issues/2075). Their branches are untouched.
- Require owner review, independent zCloud lease/preflight, exact corrected-head hosted CI and applicable permanent runner validations, latest-main integration and explicit release authorization before changing draft/HOLD state.

**No real participant data, email communication, retailer requests, private beta, public savings or M3 completion evidence were created.** All personal strings in this QA file are fictitious test canaries.
