# M4 product-core: causal private beta session event contract

Remediation for synthetic source-derived findings [#2107](https://github.com/Zennay/Supa/issues/2107) and [#2110](https://github.com/Zennay/Supa/issues/2110). **M4 human beta is not authorized** while genuine M3 field [#78](https://github.com/Zennay/Supa/issues/78) remains open. The test fixtures mark an M3 gate as closed *only to exercise validator behavior*, not as a genuine evidence claim.

## Lifecycle

For a session explicitly marked `completed`, require a `plan_started`, `plan_completed` and exactly one `beta_week_closed`. The first plan start cannot be later than the earliest plan completion, and no plan completion may occur after closing. No event may occur at/after the week closure instant other than that single closure. These causal checks are additional to the existing outer session timestamp window. `abandoned` and `unknown` sessions **may retain partial start or plan evidence** without an invented completion/closure, preserving genuine failures rather than inflating apparent retention.

## Repair time and edits

Each `repair_completed` must consume a preceding *unused* `repair_started` with exactly matching `repair_kind`. The implementation pairs against event timestamps on a sorted copy while leaving raw source event arrays unchanged. Multiple repairs of the same kind can be legitimate only when there are multiple corresponding starts; different repair kinds may interleave freely. An unmatched start is legitimate partial research evidence and **does not become** a completed repair; an unmatched or time-travelling completion is rejected before summary output. Recorded `duration_seconds` is retained as instrumented evidence, not recomputed as wall-clock delta.

## Acceptance and boundaries

`node --test tests/m4-product-causal-evidence.test.mjs`: 16 synthetic source/real-CLI controls covering a valid completed lifecycle, legitimate repeated/interleaved repairs, abandoned/unknown weeks, plan chronology violations, post-closure events, duplicate closures, orphan/reversed/wrong-kind/double repair completions and rejected real CLI publication. Source input remains byte-identical; invalid CLI inputs never create report artifacts or echo pseudonyms.

Do not modify independent original QA [#2109](https://github.com/Zennay/Supa/pull/2109) and [#2112](https://github.com/Zennay/Supa/pull/2112); owners should replay their exact original acceptance tests on this corrected source. Their event-metric and sub-millisecond concerns under [#2049](https://github.com/Zennay/Supa/issues/2049) and [#2073](https://github.com/Zennay/Supa/issues/2073) remain separate. This fix produces no actual participant, consent, recruitment, live retailer data or public claims.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** without independent zCloud preflight/write lease/claim, original source owner review, all-GREEN exact-head hosted and applicable permanent VPS, latest-main integration and explicit human release authorization.

## Actual session-start event boundary (source owner #2107 follow-up)

`startedAt` is the outer study recording window, not proof that beta instrumentation had started. The one required `beta_session_started` event also establishes a causal lower bound for **all other events**: a valid-looking planning edit, meal outcome, baseline effort or repair recorded after outer `startedAt` but **before** the actual beta start cannot be included in a private M4 summary. Activity at exactly the recorded start instant is allowed. Event arrays can be unordered; compare event timestamps, not array positions. This applies to `completed`, `abandoned` and `unknown` weeks without fabricating a required closure for incomplete sessions.

`node --test tests/m4-product-actual-session-start.test.mjs` exercises a valid control, equal-time events, unordered event arrays, pre-start planning/meal/baseline/late-start contradictions, partial-week honesty and actual CLI refusal without revealing or altering private source evidence. No timestamp parser precision changes are made here: independent timestamp issue [#2073](https://github.com/Zennay/Supa/issues/2073) and original [PR #151](https://github.com/Zennay/Supa/pull/151) remain separately owned. Genuine M3 [#78](https://github.com/Zennay/Supa/issues/78) OPEN. **DRAFT/HOLD/NO MERGE/NO DEPLOY**.
