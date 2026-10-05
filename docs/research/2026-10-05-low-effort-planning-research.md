# Low-effort planning research — 2026-10-05

## Why this research exists

SUPA is still in **M3 — full-basket comparison & real-world savings proof**. This note does not change that gate and does not authorize M4 beta execution.

It sharpens the next product hypothesis: SUPA should not merely find a cheaper basket. It should reduce the amount of thinking, replanning and avoidable food waste required to keep a weekly food plan working when time, energy or schedules change.

## Evidence reviewed

### 1. Cognitive load matters for food decisions in college students

Byrd-Bredbenner et al. studied 1,018 college students across 13 institutions. Higher cognitive load was associated with less favorable eating-related behavior. The paper explicitly frames meal planning and food selection as tasks that use limited working-memory resources.

Source:
- PubMed: https://pubmed.ncbi.nlm.nih.gov/26826647/
- DOI: https://doi.org/10.1016/j.eatbeh.2016.01.002

**Product implication:** planning effort is not a cosmetic UX metric. For SUPA's target population, the amount of mental work required to produce and repair a plan is a plausible part of the value proposition and should be measured directly.

### 2. Time, money and motivation constrain home meal preparation

A mixed-methods study of college students at risk of food insecurity found that home meal preparation can reduce cost, but heavy time demands, limited financial resources and motivation are important constraints.

Source:
- PubMed: https://pubmed.ncbi.nlm.nih.gov/37307953/
- DOI: https://doi.org/10.1016/j.appet.2023.106632

**Product implication:** a theoretically cheaper plan is weak if it assumes more preparation energy than the user can sustain. M4 should test whether SUPA helps users complete and repair a plan under real time pressure, not only whether the plan is understood.

### 3. Dutch official guidance supports a closed planning loop

Voedingscentrum currently recommends:
- check existing stock before shopping;
- plan the week;
- write down what and how much is needed;
- use leftovers intentionally;
- freeze portions and cook for multiple days;
- when the week is uncertain, prefer meals/ingredients that remain usable or can be frozen.

Sources:
- https://www.voedingscentrum.nl/nl/thema/budget/goedkoop-boodschappen-doen.aspx
- https://www.voedingscentrum.nl/encyclopedie/voedselverspilling.aspx
- https://www.voedingscentrum.nl/nl/thema/kopen-koken-bewaren/hoe-kan-ik-koken-een-persoon-of-tweepersoonshuishouden.aspx
- https://www.voedingscentrum.nl/nl/gezond-eten-met-de-schijf-van-vijf/eetpatroon-aanpassen.aspx

**Product implication:** SUPA's existing planner → exact demand → pack/reuse → shopping-list direction is consistent with official low-waste guidance. The differentiator should be automating this loop with less manual work, not teaching users a long checklist.

### 4. Community signals: savings often compete with convenience

Recent Dutch/Netherlands community discussions repeatedly surface:
- uncertainty about what a realistic grocery budget is;
- bulk cooking/freezing as a common saving tactic;
- difficulty choosing cheap meals and supermarkets;
- explicit trade-offs where people say additional saving effort is not worth the time or hassle.

These are qualitative signals, not representative population estimates.

Examples:
- https://www.reddit.com/r/thenetherlands/comments/1t4lufg/hoeveel_geven_jullie_uit_als_single_aan/
- https://www.reddit.com/r/StudyInTheNetherlands/comments/16bnldk/cheap_student_meals/
- https://www.reddit.com/r/Netherlands/comments/1vuozq0/learning_to_shop_and_cook_on_a_budget/
- https://www.reddit.com/r/thenetherlands/comments/11xuvu3/hoeveel_betalen_jullie_aan_boodschappen/

**Product implication:** "cheapest possible" is probably the wrong objective. SUPA should test a bounded trade-off: useful savings while keeping planning and repair effort low.

## Refined product hypothesis

> For independently living students with limited budget, time and mental space, SUPA is valuable when it produces a workable weekly plan and basket with fewer decisions and less replanning effort, while keeping savings and leftover consequences explainable.

This is stronger than "compare supermarkets" and narrower than "AI meal planner".

## M4 hypotheses to retain

Existing hypotheses remain valid:

- **H1 — decision burden:** target students reach a complete plan + list with fewer manual decisions than their current method.
- **H2 — reuse:** ingredient reuse lowers spend/leftover burden without making the week feel too repetitive.
- **H3 — trust:** explanations increase trust in basket recommendations.
- **H4 — repair:** low-friction repair after schedule changes increases continued use.

## Candidate evidence additions for M4

These are **research candidates only until M3/AUD-003 closes**.

### Add to the qualitative interview

Ask after each week:

1. "Wanneer liep je planning anders dan verwacht?"
2. "Wat deed je toen als eerste?"
3. "Moest je opnieuw nadenken over meerdere maaltijden of boodschappen?"
4. "Heb je hierdoor extra boodschappen gedaan, eten weggegooid of eten besteld?"
5. "Welke stap voelde als het meeste werk?"
6. "Welke aanbeveling van SUPA heb je genegeerd, en waarom?"

This captures failure/recovery behavior instead of only happy-path completion.

### Derived beta metrics worth considering

Keep the existing metrics and consider deriving:

- **repair decision count** — number of explicit choices needed after a schedule change;
- **unplanned grocery trips** — self-reported extra store trips caused by plan failure;
- **fallback meal usage** — whether a planned long-life/freezer/reuse option prevented replanning;
- **recommendation override reason** — cost, preference, availability, effort, trust or other;
- **avoidable leftover event** — leftover/waste that the participant attributes to plan failure or pack mismatch.

Do not add telemetry merely because it is measurable. Only add a field if a real beta question needs it.

## Product/backlog consequences

### Keep

- planner-first flow;
- explicit weekly budget;
- exact quantities;
- reuse and pack-size reasoning;
- transparent basket explanation;
- schedule-repair concept;
- worse/unknown outcomes instead of forced savings claims.

### Strengthen after M3

1. **Low-energy fallback as a product hypothesis**
   - Test whether one or two long-life/freezer-friendly fallback meals reduce replanning and takeaway/store trips.
   - Do not build a large "emergency meal" feature before beta evidence supports it.

2. **Make reuse automatic, not another chore**
   - Reuse suggestions should appear as a consequence of the plan and pack sizes.
   - Avoid requiring users to manually maintain a detailed pantry inventory in the first beta.

3. **Measure effort beside euros**
   - A cheaper basket that creates substantially more decisions or store visits may be a worse product outcome.
   - M4 analysis should present cost outcome and effort outcome side by side.

4. **Treat schedule repair as a first-class test**
   - A plan that only works when the week stays stable is not sufficient for the target user.
   - Beta sessions should deliberately capture naturally occurring changes rather than manufacturing artificial failures.

## Recruitment implication for M4

The eventual private beta should prioritize independently living students who:
- usually decide/cook their own meals;
- pay for most of their own groceries;
- experience at least occasional budget pressure;
- have variable schedules or low-energy days;
- currently use anything from no planning to notes/apps/spreadsheets.

Do not recruit only highly organized meal-preppers; that would bias the test toward people who already tolerate planning work.

## Guardrail

This research **does not close M3**, does not create observed savings evidence and does not justify M4 implementation or recruitment yet.

The current product-critical dependency remains:

> one genuine same-demand PLUS + DekaMarkt basket pair, observed in one shared price context within 24 hours, then processed through the existing M3 build + assessment path.

After that gate closes, use this note to review the M4 protocol and decide which candidate questions/metrics deserve implementation.
