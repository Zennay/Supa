# Independent M5 offline review queue integrity — 13 October 2026

## Frozen product source and ownership

- Independent source: [DRAFT product #2126](https://github.com/Zennay/Supa/pull/2126), exact immutable SHA `27c31de019802ef65353e9b75290d00ed6874d26`; its parent [DRAFT #2108](https://github.com/Zennay/Supa/pull/2108) remains owned separately.
- Frozen QA base: `qa/frozen-m5-selector-owner-27c31de0-20261013`; independent add-only QA test `tests/qa-m5-selector-metadata-identity-boundary-20261013.test.mjs` and this document. Never edit original `scripts/m5-build-selector-review-queue.mjs`, product owner's tests/docs, workflows, other QA PRs, main or real captures.
- [QA issue #2128](https://github.com/Zennay/Supa/issues/2128) identifies protocol acceptance hazards **from read-only source inspection only**, not a proven external attack or production incident.

## Seven deterministic, offline synthetic cases

Three positive controls must remain GREEN: different ASCII source IDs have stable distinct opaque tokens and never set trusted rights/selector/production flags; an actually unavailable capture with canonical null hashes is P1 *human* recapture review; legitimate verified schema-org status transitions are P1 manual drift review, never permission or selector approval.

Four intentional RED controls on the frozen product source:
1. Distinct malformed UTF-16 source IDs with opposite isolated surrogates produce identical UTF-8 replacement bytes and therefore SHA-256 tokens. Reject ill-formed source identities before hashing; this is an **encoding collision**, not a hash break or real sensitive disclosure.
2. A verified snapshot with invented `schemaOrgStatus=production_verified` matches an equally forged baseline and is reported `unchanged`, though upstream `captureShape` only emits `candidate_observation`, `abstain` or `unknown`.
3. An unavailable snapshot with a non-null SHA-256 hash is accepted, contrary to canonical `captureShape()`, which emits both snapshot and shape hashes `null`.
4. An unavailable snapshot with `schemaOrgStatus=candidate_observation` is accepted, contrary to canonical `unknown`.

For source-owner correction, prefer checking well-formed identity Unicode, collision-free token mapping and validated status-specific snapshot fields. Preserve legitimate `unavailable` work and never turn the offline review queue into automated source approval or a collection operation. A later independent new *corrected exact-head* test replay must turn all four intentional RED GREEN without changing QA assertions. Initial RED CI is expected and is **not** evidence of a new incident.

## Gates

Run immutable exact HEAD with normal GitHub-hosted CI and record the real test counts; high audit, M1 benchmark/permission and production build cannot be described as successful if CI aborts at intentional-red unit tests. Permanent relevant VPS and source-owner review remain independent requirements.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.** SUPA is M3 ACTIVE; genuine human PLUS+DekaMarkt same-demand observed study [#78](https://github.com/Zennay/Supa/issues/78) is still open. M4/M5 research, retailers, production ingestion and any public savings claim remain unauthorized. Independent zCloud preflight/write-lease, latest-main integration and explicit human go are required for future promotion.
