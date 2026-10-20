# Independent Supa M4 lifecycle causality QA — 2026-10-13

**Original isolated issue:** [#2107](https://github.com/Zennay/Supa/issues/2107).  
**Frozen source:** `main` commit `c36f5c8f71d77cae94663978b51a194e9b183af6`.  
**Ownership:** quality-validation only; independent add-only test and this document. No existing code, workflows, tests, product branches, Notion gate, real field evidence or retailer requests change.

## Why it matters

`scripts/m4-validate-beta-session.mjs` validates legal event kinds and that timestamps occur inside the recorded outer session start/end. For `completed`, it requires at least one `plan_completed` and one `beta_week_closed`. However a completed study can (on frozen main):

1. omit `plan_started` altogether;
2. report `plan_completed` before the recorded `plan_started`;
3. report `beta_week_closed` before `plan_completed`;
4. include meal/activity events **after** the sole `beta_week_closed`, though still inside the outer session;
5. include two `beta_week_closed` events with ambiguous final state.

These are synthetic research-integrity problems: a summary saying `completed` should not make an impossible timeline seem credible. They are **not** real participant telemetry, a real beta, or real savings observations.

## Reproducible offline acceptance

```bash
node --test tests/m4-causal-lifecycle-independent-qa.test.mjs
```

- Three **expected GREEN**: fictional ordered completed-week validation; abandoned/unknown sessions retain honest partial evidence without completion; real CLI accepts canonical fictional finished week, emitting a private/no-public-claim summary.
- Five **expected RED** direct validator assertions (one for each invalid chronology above).
- One **expected RED** subprocess acceptance: real CLI must refuse omitted-plan-start `completed` evidence, leave the private destination absent, and not print a report/pseudonym.
- Clock times differ by whole minutes. Unlike [#2073](https://github.com/Zennay/Supa/issues/2073), this does **not** address timestamp fractional precision.
- Fixture includes an explicitly fictional `m3Gate.status=closed` **only** to exercise M4 parsing. Actual M3 [#78](https://github.com/Zennay/Supa/issues/78) is open, and no participant records, monetary values or external sites are accessed.

## Safe owner policy questions

Define exact event lifecycle contract in M4 source ownership, and preserve legitimate `abandoned` or `unknown` sessions and their partial data. Multiple planning attempts and completed-plan revisions may need a documented association rule; do **not** accidentally reject legitimate flexibility to make the tests green. After an original-source fix, independently replay the identical acceptance tests on its immutable corrected revision and verify a fresh current-main integration.

## Release gates

**DRAFT/HOLD/NO MERGE/NO DEPLOY**. Independent zCloud coordination preflight/write lease, original owner approval, exact corrected-head all-green hosted + applicable permanent VPS/mobile tests, latest-main composition, and explicit human release authorization are outstanding. M3 genuine same-demand PLUS/DekaMarkt 11+11 evidence is still required before M4 can start.
