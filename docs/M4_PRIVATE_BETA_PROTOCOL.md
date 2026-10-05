# M4 private beta evidence protocol

M4 validates SUPA's current product wedge: a low-work closed loop from weekly constraints to a usable plan, exact demand, basket economics and repair when real life changes.

This document makes the research protocol executable without starting the beta early.

## Dependency: M3 must close first

Do **not** collect or accept M4 beta session evidence while PWQ-14 / AUD-003 is open.

Every beta session record must carry:

```json
{
  "m3Gate": {
    "status": "closed",
    "evidenceRef": "reference to the closed M3/AUD-003 evidence"
  }
}
```

The validator fails closed when this gate is not present and closed. Protocol design and synthetic contract tests may exist before M3 closes; real participant execution may not.

## Target sample

Private beta with 10–20 target students.

Recruit for fit with the product problem rather than convenience alone:
- lives independently or largely manages their own groceries;
- regularly decides what to eat for multiple days;
- has some budget, time or waste pressure;
- can compare SUPA with their current planning method.

Do not generalize the observed sample into population claims.

## Hypotheses

### H1 — lower planning effort

A target student reaches a usable plan + shopping list with fewer explicit decisions and manual list edits than their current method.

Primary measures:
- time to first complete weekly plan;
- explicit meal decisions;
- manual ingredient/list edits;
- self-reported planning effort before vs after.

### H2 — reuse without unacceptable repetition

Ingredient reuse should reduce leftover burden while still feeling acceptable.

Measures:
- leftover/waste events;
- reuse acceptability score (1–7);
- planned-meal adherence;
- qualitative friction around repetition or forced combinations.

### H3 — explanation trust

Savings explanations should increase confidence without hiding uncertainty.

Measures:
- explanation trust score (1–7);
- observed basket outcome: `better`, `same`, `worse`, or `unknown`;
- qualitative comments on what was or was not understandable.

### H4 — low-friction repair

A schedule change should not force a complete restart.

Measures:
- number of plan-repair events;
- qualitative repair friction;
- whether the participant would use SUPA again.

## Session record contract

The versioned input record intentionally keeps identifying data out of the schema.

Required top-level fields:
- `schemaVersion: 1`;
- `sessionType: "m4-private-beta-session"`;
- pseudonymous `sessionId` and `participantKey`;
- target `population`;
- research consent flags;
- closed M3 gate reference;
- `startedAt` and `endedAt`;
- `sessionOutcome`: `completed`, `abandoned`, or `unknown`;
- `observedBasketOutcome`: `better`, `same`, `worse`, or `unknown`;
- planned/followed meal counts;
- event list;
- 1–7 self-report scores.

Allowed events:
- `meal-decision`;
- `list-edit`;
- `plan-repair`;
- `leftover-waste`;
- `plan-completed`.

Use `count` only when one timestamp represents multiple equivalent actions. Do not collapse distinct events when timing matters.

## Privacy boundary

Do not commit names, email addresses, phone numbers, account IDs, receipt images or other direct identifiers.

Use a study-local pseudonymous `participantKey`. The generated summary deliberately omits this key.

Qualitative strings are optional. Before versioning or sharing them, remove names, places or other details that could identify the participant.

## Validate one session

After M3 closes and a consented beta session exists:

```bash
npm run m4:validate-beta-session -- evidence/m4/<session>.json --output artifacts/m4/<session>-summary.json
```

The command:
- rejects a non-closed M3 gate;
- validates session timestamps and event windows;
- preserves abandoned and unknown cases;
- derives event counts and time to first complete plan;
- calculates planned-meal adherence;
- emits a privacy-safer aggregate summary;
- always keeps `publicClaimEligible: false`.

## Evidence handling

Keep all valid outcomes:
- positive;
- negative;
- abandoned;
- unknown.

Do not remove a record because SUPA was slower, more effortful, more wasteful or more expensive.

A completed session requires a real `plan-completed` event. An abandoned session may legitimately have no completion time.

## Suggested analysis after 10–20 sessions

Report distributions and counts rather than a single headline average:
- median and range for time to first complete plan;
- median explicit meal decisions and list edits;
- repair-event frequency;
- planned-meal adherence distribution;
- before/after planning-effort distribution;
- reuse acceptability and explanation-trust distribution;
- counts of better/same/worse/unknown basket outcomes;
- completion vs abandonment;
- recurring qualitative failure modes.

The decision question is not "did everyone save money?". It is whether the closed loop produces enough combined value in effort, flexibility, reuse, trust and basket economics to justify continued product investment.

## Current status

This protocol and validator are preparatory infrastructure only. They do not start M4 beta execution and do not alter the current M3 exit gate.
