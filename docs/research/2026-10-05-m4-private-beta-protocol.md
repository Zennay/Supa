# SUPA M4 private beta protocol — 2026-10-05

## Status and gate

This document is **protocol design only**. It does not start M4 beta execution.

M4 recruitment, participant sessions and product expansion remain blocked until **PWQ-14 / AUD-003** is closed with one genuine same-demand two-store basket pair collected within 24 hours in one shared price context.

Research/protocol design may continue while that gate is open.

## Objective

Test whether SUPA's closed-loop flow reduces planning effort while keeping food choices flexible, understandable and economically trustworthy for target students.

The beta is not intended to prove a population-level savings claim. It is designed to expose positive, negative and unknown cases and identify whether the narrow loop is valuable enough to continue.

## Target participants

Recruit **10–20 independently living students** who currently make at least some of their own grocery and meal-planning decisions.

Prefer variation across:
- strict vs loose weekly food budgets;
- structured planners vs ad-hoc shoppers;
- cooking confidence;
- predictable vs changing weekly schedules;
- solo cooking vs shared meals.

Do not filter only for people who already like meal-planning apps.

## Study shape

Use a lightweight within-participant design over multiple weeks.

### Baseline
Before SUPA use, capture the participant's normal method for planning the coming week:
- planning start/end time;
- explicit meal decisions;
- list edits or ingredient decisions;
- expected weekly grocery budget;
- self-reported planning effort (1–5);
- confidence that the plan will survive schedule changes (1–5).

### SUPA-assisted weeks
For each beta week:
1. participant starts from budget, schedule/time and food preferences;
2. participant reaches a complete weekly plan + shopping list;
3. SUPA records planning effort events;
4. participant uses the plan in normal life;
5. schedule changes/repairs are recorded when they happen;
6. end-of-week adherence, leftover/waste and basket outcome are captured;
7. participant rates explanation trust and planning effort;
8. a short qualitative interview captures what felt helpful, annoying, confusing or too rigid.

Aim for at least two SUPA-assisted weeks per participant where practical. Preserve partial weeks rather than silently dropping them.

## Hypotheses and primary measures

### H1 — closed-loop planning reduces mental/manual effort

Primary measures:
- time to first complete weekly plan;
- explicit meal decisions required;
- manual ingredient/list edits;
- self-reported planning effort (1–5).

Comparison:
- participant baseline vs SUPA-assisted week(s);
- report participant-level deltas and sample medians;
- do not call a result better when baseline or SUPA timing is incomplete.

### H2 — ingredient reuse is useful without becoming repetitive

Primary measures:
- number of planned shared-ingredient/reuse opportunities;
- accepted vs manually removed reuse suggestions;
- leftover events;
- avoidable waste events;
- qualitative acceptance: useful / neutral / repetitive / annoying.

A lower basket price does not count as a win if participants consistently reject the meal pairing or report more leftover burden.

### H3 — savings explanations improve trust

Primary measures:
- explanation viewed before decision;
- trust rating (1–5);
- whether unresolved/unknown basket lines were understood;
- whether the participant followed or overrode the recommendation;
- reason for override.

Preserve cases where the cheaper option is rejected for convenience, availability, preference or uncertainty.

### H4 — flexible repair supports continued use

Primary measures:
- schedule-change events;
- repair attempts;
- repair completion time;
- number of manual edits during repair;
- whether the participant resumes the plan after repair;
- stated likelihood of using SUPA next week (1–5).

## Event vocabulary

Version these event names before beta execution. Event payload implementation may follow after the M3 gate closes.

| Event | Required payload |
| --- | --- |
| `beta_session_started` | participant_id, study_week_id, timestamp |
| `baseline_planning_completed` | duration_seconds, explicit_meal_decisions, manual_edits, effort_rating |
| `plan_started` | budget_cents, planned_days_count, timestamp |
| `meal_decision_recorded` | meal_slot, decision_kind |
| `plan_completed` | duration_seconds, planned_meals_count, explicit_meal_decisions |
| `list_edit_recorded` | edit_kind, item_key |
| `reuse_explanation_viewed` | ingredient_key, related_meal_count |
| `schedule_change_recorded` | change_kind, affected_slot |
| `repair_started` | repair_kind, timestamp |
| `repair_completed` | repair_kind, duration_seconds, manual_edits |
| `meal_outcome_recorded` | meal_slot, outcome: followed/skipped/swapped/unknown |
| `leftover_event_recorded` | ingredient_key, outcome: reused/wasted/remaining/unknown |
| `basket_assessment_viewed` | outcome: better/same/worse/unknown, unresolved_line_count |
| `basket_recommendation_decided` | followed, reason |
| `trust_rating_submitted` | rating_1_to_5, uncertainty_understood |
| `weekly_effort_submitted` | rating_1_to_5 |
| `beta_week_closed` | return_intent_1_to_5, interview_complete |

## Derived metrics

Calculate only from observed data:
- planning duration delta vs participant baseline;
- explicit-decision delta vs baseline;
- manual-edit delta vs baseline;
- median repair duration;
- plan adherence = followed planned meals / meals with known outcomes;
- reuse acceptance = accepted reuse opportunities / reuse opportunities shown;
- leftover burden = wasted + remaining events, kept separate from reused events;
- recommendation follow rate;
- trust distribution;
- return-intent distribution.

Never coerce missing events into zero. Unknown remains unknown.

## Qualitative interview prompts

Use the same prompts after each completed beta week:
1. What part of planning still felt like work?
2. What did SUPA decide for you that you were happy not to decide yourself?
3. Where did you override SUPA, and why?
4. Did ingredient reuse feel efficient or repetitive?
5. When your week changed, how easy was it to repair the plan?
6. Did you understand why one basket/store option was recommended?
7. What would stop you from using this again next week?
8. What is the one thing you would keep even if the rest of SUPA disappeared?

## Evidence boundaries

- No public savings percentage from this beta.
- Keep participant-level positive, negative and unknown outcomes.
- Treat self-reported effort separately from timed/observed effort.
- Treat observed basket results separately from perceived savings.
- Do not discard participants because SUPA performs worse.
- Do not infer zero leftovers, zero edits or full adherence from missing data.
- Record protocol deviations explicitly.

## Privacy

- Use pseudonymous participant IDs.
- Do not commit names, email addresses, raw receipts containing personal data, or free-text notes with identifying details.
- Store only privacy-safe derived research artifacts in the repository.
- Raw interview/receipt material, if retained at all, must live in an approved private location with an explicit retention decision.

## Predefined beta readout

M4 should produce an evidence table per participant/week with:
- baseline planning effort;
- SUPA planning effort;
- repair effort;
- adherence;
- reuse/leftover outcome;
- observed basket outcome;
- trust;
- return intent;
- key qualitative friction.

The milestone is ready for a product decision when:
1. 10–20 target students have been invited into the executable protocol;
2. enough completed weeks exist to show repeated-use behavior, not only first impressions;
3. positive, negative and unknown outcomes are all retained;
4. the team can identify which part of the closed loop creates or destroys value;
5. any recommendation is explicitly bounded to the observed sample.

## Decision rules after beta

- **Continue:** effort falls for a meaningful share of participants, repairs are workable, trust is adequate and repeat intent is credible even when savings are mixed.
- **Iterate:** users value the concept but one step (planning, reuse, repair, explanation or basket choice) creates recurring friction.
- **Reposition:** savings/comparison works but closed-loop planning does not reduce effort.
- **No-go:** the narrow loop creates more work, low trust or persistent rigidity without a clear fix.

No decision rule overrides the M3 evidence gate or retailer-data permission constraints.

## Execution checklist after M3 closes

- lock protocol version and event vocabulary;
- prepare participant consent + privacy wording;
- implement only the instrumentation needed by this protocol;
- dry-run one internal synthetic session to verify event completeness;
- recruit target students;
- run baseline + SUPA-assisted weeks;
- review missingness after each session without changing success criteria mid-study;
- synthesize quantitative + qualitative evidence;
- update M4 issue/Notion with the bounded decision.
