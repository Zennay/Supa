# Independent QA — M3 exact observation-clock invariants (2026-10-11)

**Scope:** independent, synthetic acceptance of the isolated product precision repair [#1525](https://github.com/Zennay/Supa/pull/1525) and open safety issue [#1513](https://github.com/Zennay/Supa/issues/1513). This document and a NEW test file only; original source owner, field evidence, existing tests, workflows and canonical main remain untouched.

## Machine-verifiable assertions
- The same observed instant expressed under five UTC offsets, including +05:45 and -04:30, retains every fractional digit width 1–9. Expected epoch nanoseconds use an independent fixed UTC calendar anchor, not the implementation parser as oracle.
- Normalizing an observed timestamp to canonical UTC preserves the exact instant and is idempotent. A second normalization must not alter the string.
- Across the +02:00 to +01:00 transition, an exact 24h and 24h−1ns interval remain inside; 24h+1ns stays outside, including reversed helper arguments.
- Positive decimal window limits 0.1h, 0.25h and 1.5h reject the first nanosecond after their limits.
- The resulting first-observation deadline preserves nine significant fractional digits; sub-nanosecond hour increments and invalid calendar/fraction/offset timestamps are rejected, never silently rounded into valid observations.

## Reproduction
`node --experimental-strip-types --test tests/qa-m3-clock-offset-metamorphic-acceptance.test.mjs`

Use hosted `npm test`, audit, source-permission gate, matching benchmark and production build for exact-HEAD evidence. Permanent VPS/Firefox/M3 workflow proof is a separate owner/release check, not implied by this test.

## Evidence limitations and authority
The tests do **not** sample, derive, or validate PLUS/DekaMarkt prices. No real savings, production rights, participant data or public-claim eligibility is established. Real same-demand two-store field collection [#78](https://github.com/Zennay/Supa/issues/78) remains independent; cross-basket mutable-Proxy atomicity [#1508](https://github.com/Zennay/Supa/issues/1508) is outside this scope.

**DRAFT / HOLD / NO MERGE / NO DEPLOY** until verified zCloud coordination lease, original precision-source owner approval, exact-head hosted and required permanent runner evidence, and safe latest-main integration of #1525 first. The QA branch pins immutable repair SHA `546eb2e56630bbb9232b299cdaede9a789241bf1`.
