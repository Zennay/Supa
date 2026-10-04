# SUPA competitive positioning update — 2026-10-04

## Decision

SUPA should **not** position full-basket supermarket comparison as its primary differentiator.

By October 2026, Dutch products such as Supertje, Bonchecker, Mandje and WinkelDuel already compare complete shopping lists or baskets across supermarkets in different forms. International meal-planning products such as Samsung Food and Mealime already convert meal plans into consolidated grocery lists.

SUPA's sharper product wedge is therefore:

> **Turn a user's budget, time and food preferences into a flexible weekly plan whose complete grocery basket is optimized for real cost, pack sizes and ingredient reuse — with as little manual planning work as possible.**

The differentiator is the **closed loop** between planning and basket economics, not either capability in isolation.

## Current market evidence

### Dutch basket/list comparison is becoming table stakes

- Supertje says it compares a complete shopping list and can calculate the cheapest combination of stores, with daily prices for multiple Dutch supermarkets:
  https://supertje.nl/
- Bonchecker exposes basket comparison across stores, alongside product search and price history:
  https://bonchecker.nl/
- Mandje positions itself around comparing an entire shopping list across supermarkets and also exposes price-per-unit/history:
  https://mijnmandje.nl/blog/beste-boodschappen-apps-nederland
- WinkelDuel positions around splitting one list across multiple supermarkets, including promotions and price-per-kilo/litre:
  https://www.winkelduel.com/

Product consequence: "compare your basket" is valuable, but it is no longer enough to explain why SUPA should exist.

### Meal plan -> grocery list is also established

- Samsung Food lets users create a weekly meal plan and turn that plan into a shopping list; it also supports food inventory and online checkout in some markets:
  https://samsungfood.com/meal-planner/
  https://samsungfood.com/grocery-list-app/
- Mealime creates meal plans and automatically consolidates recipe ingredients into a grocery list with the quantities needed:
  https://support.mealime.com/article/151-getting-started-guide

Product consequence: SUPA should not treat plan-to-list generation alone as a moat either.

## Community pain signals

Recent community discussions repeatedly describe the same failure modes:

- meal planning becomes **more work instead of less**;
- apps are too rigid or visually/operationally cluttered;
- users still have to hunt down random ingredients;
- plans create leftovers or food waste when real life changes;
- disconnected recipe, pantry, list and shopping workflows increase mental load.

Examples:
- https://www.reddit.com/r/MealPrepSunday/comments/1rfmx8q/is_there_actually_a_meal_planning_tool_that/
- https://www.reddit.com/r/mealprep/comments/1rsgprn/why_do_meal_planning_recipe_apps_lose_me_so_fast/
- https://www.reddit.com/r/ProductivityApps/comments/1sewevg/i_built_an_app_to_solve_the_most_annoying_daily/
- https://www.reddit.com/r/mealplanning/comments/1uw1rg1/how_do_you_meal_plan_without_ending_up_with_too/

These are qualitative signals, not representative population evidence. They are useful for shaping hypotheses for M4, not for making market-size or prevalence claims.

## Product implication

SUPA should optimize a **planned basket**, not merely compare a typed list.

That means the system should eventually be able to answer:

1. What meals fit this user's budget, schedule and preferences this week?
2. Which combination of meals reuses ingredients and pack sizes efficiently?
3. What exact purchasable quantities does that imply?
4. Which store/basket choice is cheapest enough to matter after unresolved matches and availability are considered?
5. Where does the saving come from: pack-size reuse, offer, product choice or planning?
6. How much work did SUPA remove from the user?

## Product contract additions

### 1. Low-work is a first-class outcome

Do not optimize only euros. Measure the effort required to get from "I need food this week" to a usable plan and list.

Candidate M4 measures:
- time to first complete weekly plan;
- number of manual ingredient/list edits;
- number of explicit meal decisions required;
- number of plan repairs/swaps during the week;
- percentage of planned meals actually followed;
- self-reported planning effort before/after SUPA.

### 2. Reuse must be visible and practical

Ingredient reuse should not be a hidden optimizer score. The UI should be able to explain:
- which ingredients are shared across meals;
- which pack sizes are being finished across the week;
- which leftovers are intentionally carried to another meal;
- what happens when a planned meal is skipped.

### 3. Price comparison is a decision layer, not the entry point

List-first comparators already exist. SUPA should begin from the user's weekly eating problem and let price comparison happen automatically downstream.

### 4. Flexibility must survive real life

A "cheap" static plan that collapses when the user eats out, works late or loses energy does not satisfy the product promise.

The planner should eventually support low-friction repair:
- skip a meal;
- swap a meal;
- use an already-bought ingredient first;
- keep the remaining basket/list coherent;
- recalculate cost impact without forcing a full re-plan.

## M4 hypotheses to validate after M3 closes

H1 — **Closed-loop planning beats list-first comparison for mental effort.**
A target student can produce a usable week plan + shopping list with fewer manual decisions than their current method.

H2 — **Ingredient reuse is valuable only when it reduces both spend and leftover burden.**
Users should understand why two meals are paired and accept the reuse rather than experience it as repetitive.

H3 — **Savings explanations increase trust.**
Users are more willing to follow a cheaper basket when SUPA shows the source of the difference and unresolved uncertainty.

H4 — **Flexible repair drives repeat use.**
Users who can quickly repair the week after a changed plan are more likely to return than users forced to recreate the week.

## Guardrail

Do not expand M3 implementation to chase these hypotheses before the real observed-basket gate closes.

This research changes **positioning and the next beta hypotheses**, not the current M3 evidence boundary.
