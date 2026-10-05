# Planner-first activation & core-repertoire research — 2026-10-05

## Why this research exists

SUPA is still in **M3 — full-basket comparison & real-world savings proof**. This note does not change the M3 gate and does not authorize M4 recruitment or beta execution.

It addresses two still-material assumptions in the canonical audit:

- **A-003:** 20–30 controlled recipes are enough for a meaningful first beta.
- **A-004:** planner-first remains the strongest activation surface outside prototype testing.

The key question is not whether SUPA should eventually support 20–30 recipes. It is whether showing a broad catalog early helps the target student get to a workable week with less effort, or simply moves decision burden into the product.

## Evidence reviewed

### 1. Current student research still points to time, cost and convenience as dominant constraints

A 2026 mixed-methods study of 501 emerging-adult college students found barriers including limited time, financial constraints, inadequate kitchen access/equipment and concerns about affordability even when convenience-oriented meal-kit concepts were attractive.

Sources:
- https://pmc.ncbi.nlm.nih.gov/articles/PMC13454157/
- https://pubmed.ncbi.nlm.nih.gov/42370479/

A 2025 UK university focus-group study similarly reports limited budget, time-management struggles and cooking-skill constraints as common reasons students' diets change after starting university.

Sources:
- https://pubmed.ncbi.nlm.nih.gov/40208897/
- https://pmc.ncbi.nlm.nih.gov/articles/PMC11984744/

**Product implication:** recipe breadth is not automatically user value. The first-run planner should optimize for getting from "I need food this week" to a usable plan with low decision cost.

### 2. Meal planning is already conventional advice, so the interaction burden matters more than the existence of a planner

Albert Heijn's current consumer guidance explicitly recommends planning meals for the week and making a shopping list as a way to shop more deliberately.

Source:
- https://www.ah.nl/inspiratie/besparen/boodschappenlijstje-maken

This reinforces the existing competitive finding that planning/list generation alone is not a moat.

**Product implication:** SUPA needs to prove that its planner is materially easier or more useful than a normal weekly-menu/list habit because it connects budget, exact quantities, reuse, pack-size economics and basket outcome.

### 3. Current Dutch student discussions show heterogeneous routines, but repeated simple meals and freezing are normal saving tactics

Recent qualitative community signals from students in the Netherlands include:
- cooking one dish for multiple portions;
- freezing leftovers/extra portions;
- doing one larger weekly shop;
- using supermarket offers/personalized discounts;
- mixing supermarkets depending on product and price;
- admitting that poor meal planning increases spend.

Examples:
- https://www.reddit.com/r/StudyInTheNetherlands/comments/1upspdq/how_much_do_you_actually_spend_on_groceries_each/
- https://www.reddit.com/r/StudyInTheNetherlands/comments/1vhk8jc/looking_for_student_recipes/
- https://www.reddit.com/r/Netherlands/comments/1vuozq0/learning_to_shop_and_cook_on_a_budget/

These are qualitative signals, not representative prevalence estimates.

**Product implication:** SUPA should not assume users require high novelty every week. Repetition can be a feature when it lowers spend and effort, as long as the user keeps control and does not experience the week as monotonous.

## Refined hypothesis

> Planner-first remains plausible, but activation should optimize for a **small understandable choice set that can produce a complete week quickly**, with broader recipe variety progressively available rather than demanded up front.

This is deliberately a hypothesis for M4, not a redesign mandate before M3 closes.

## Consequence for the existing 20–30 recipe boundary

Keep **20–30 controlled recipes** as a reasonable bounded catalog for the first beta, because it limits data/matching complexity.

Do **not** interpret that number as "show 20–30 options during first-run planning."

Instead, test a progressive choice model:

1. start from a small recommended subset based on budget, time and preferences;
2. let users swap or expand when the suggested set is not acceptable;
3. preserve repeated/familiar meals as valid;
4. expose the full controlled catalog only when the user asks for more choice.

A candidate first-run subset might be **6–10 meals**, but that number is not evidence-backed yet and should be treated as an experiment parameter rather than a product requirement.

## M4 evidence additions

These additions fit the existing H1/H2/H4 protocol and should only be activated after the M3 gate closes.

### Measure selection burden

Capture:
- number of recipes initially presented;
- number of recipe cards/options inspected before accepting a week;
- number of explicit swaps before first complete plan;
- time from planner entry to first complete plan;
- whether the user expanded beyond the recommended subset;
- self-reported "too little / enough / too much choice."

### Measure repetition tolerance instead of assuming variety demand

After each beta week ask:
- Which meal would you happily repeat next week?
- Which meal felt repetitive or boring?
- Did repeating a meal make planning/shopping easier?
- Did you freeze or intentionally carry a portion forward?
- Did you reject a cheaper/reuse-friendly combination because you wanted more variety?

### Compare outcomes, not clicks alone

A smaller choice set is only better if it reduces effort **without** materially hurting:
- plan acceptance;
- dietary/preference fit;
- perceived variety;
- observed basket outcome;
- repeated-use intent.

## Product/backlog consequences

### Keep now

- planner-first product direction;
- 20–30 controlled-recipe beta ceiling;
- exact-quantity and pack/reuse reasoning;
- low-energy/fallback hypothesis;
- transparent user override.

### Change in the M4 design review after M3

1. **Make recipe breadth progressive**
   - Recommended subset first.
   - Full controlled catalog remains available but secondary.

2. **Treat familiar/repeated meals as valid**
   - Do not optimize novelty as a hidden quality score.
   - Let repeated meals compete on effort, preference, reuse and cost.

3. **Measure decision burden explicitly**
   - Recipe-option exposure and swap count become part of H1 evidence.

4. **Do not build personalization complexity before evidence**
   - A simple deterministic recommendation subset is sufficient for the first test.
   - Broad AI recipe generation remains outside the first beta proof.

## Decision rule for M4

After several real beta sessions, keep the smaller recommended subset if:
- time-to-plan and manual decisions fall;
- users rarely expand to the full catalog;
- perceived variety remains acceptable;
- plan adherence does not materially worsen.

Expand or redesign if:
- users frequently open the full catalog immediately;
- repeated meals create rejection/drop-off;
- preference mismatch causes excessive swapping;
- the small subset prevents acceptable budget/schedule combinations.

## Guardrail

This research **does not close M3** and should not cause new M3 collector work.

The product-critical gate remains:

> one genuine same-demand PLUS + DekaMarkt basket pair, observed within 24 hours in one shared price context, processed through the existing M3 build + assessment path.

Only after that gate closes should this note change the private-beta planner experience or instrumentation.
