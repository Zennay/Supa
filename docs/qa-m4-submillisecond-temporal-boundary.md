# SUPA M4 sub-millisecond time-integrity QA (synthetic only)

- Issue: [#2073](https://github.com/Zennay/Supa/issues/2073).
- QA branch base: `main` at `c36f5c8f71d77cae94663978b51a194e9b183af6`.
- Target: `scripts/m4-validate-beta-session.mjs`, **read-only** in this QA branch.
- Added executable regression: `tests/m4-submillisecond-temporal-boundary-qa.test.mjs`.
- Status: **EXPECTED RED / DRAFT / HOLD / NO MERGE / NO DEPLOY**.

## Precise risk

`Date.parse('2026-10-12T10:00:00.0001Z') === Date.parse('2026-10-12T10:00:00.0009Z')` despite distinct instants. This affects:

1. `endedAt >= startedAt` acceptance when the session is actually inverted;
2. `event.timestamp <= endedAt` acceptance when the event is later than session closure;
3. `explanationViewedBeforeDecision` when decision occurs before the explanation;
4. `latestEvent()` choosing an older optimistic `better` basket event instead of a later `unknown` one when both occupy the same millisecond.

The regression calls **real exported source functions**, uses only fictional abandoned/unknown beta session data, and asserts no public claim or participant identifier in valid summary output. The two valid millisecond controls should remain green. Four hostile precision cases must fail on current main; that failing CI is **intentional evidence of an unaddressed finding**.

## Narrow remediation contract (separate owner-reviewed source branch)

Either fail closed on unsupported fractions finer than milliseconds, or retain precision during *every* timestamp comparison (session bounds, event window, explanation ordering). Avoid accepting high-precision metadata and then flooring just for ordering. Keep general canonical-date/timezone review from [#151](https://github.com/Zennay/Supa/pull/151); keep safe integer regression [#2049](https://github.com/Zennay/Supa/issues/2049) separate.

## Release truth

M3 genuine PLUS + DekaMarkt field pair [#78](https://github.com/Zennay/Supa/issues/78) is not yet observed. These test objects set `m3Gate.status='closed'` as a **synthetic fixture precondition solely for exercising validator code**; they are *not* real-world M3 closure, beta sessions, human evidence, retailer prices, or permissions. Do not merge/deploy or mark M4 eligible.

Before any source integration: obtain independent zCloud preflight/write claim/lease and M4 validator owner coordination; replay tests on latest main, verify exact SHA hosted and applicable permanent VPS checks, privacy and release gates, and human approval. Keep unrelated source, App, workflow, owner branches and observed participant artifacts untouched.
