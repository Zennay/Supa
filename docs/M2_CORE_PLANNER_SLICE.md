# M2 Core Planner Vertical Slice

## Goal

Prove one deterministic user path from a planning preference to a recipe plan,
ingredient mapping, a one-store basket and a shopping list.

M2 deliberately does **not** make a savings claim. M3 owns measured
full-basket savings. The initial M2 catalog is a controlled fixture so product
behavior is reproducible while the technical M1 live-source evidence remains
separate from production reuse permission.

## Executable contract

The current slice connects the three existing mobile surfaces:

1. **Planner**
   - each active day resolves to exactly one planned meal; duplicate active day identities fail closed instead of silently double-counting demand;
   - choose a week budget;
   - activate/deactivate meal days;
   - choose a recipe per planned day.
2. **Ingredient aggregation**
   - repeated recipe ingredients are combined before pack calculation;
   - inconsistent ingredient definitions fail instead of silently merging.
3. **Matching**
   - the M1 fail-closed matcher selects a product only above its trust
     thresholds;
   - uncertain ingredients remain explicit unresolved lines.
4. **One-store basket**
   - required quantities are converted to compatible base units;
   - required pack count is deterministic;
   - each line exposes the selected product, match score/reasons and line cost.
5. **Shopping list**
   - generated from the same basket trace;
   - unresolved ingredients remain visible as manual-selection items.
6. **Planner continuity**
   - budget, active days and recipe choice per day persist as one local v2 preference contract;
   - malformed/stale storage fails back to current valid defaults;
   - an intentionally empty week stays empty.

## Default deterministic proof

The default four-meal fixture contains a repeated Tikka bowl. Its two
kippendij requirements aggregate to 600 g before matching, which requires two
400 g packs in the controlled store catalog.

The default basket is intentionally reproducible:

- selected meals: 4;
- matched ingredient lines: 10;
- unresolved ingredient lines: 1;
- deterministic matched total: EUR 30.08;
- unresolved example: garam masala, which abstains rather than guessing
  another spice.

Changing the active days or recipe selection recalculates the same basket and
shopping-list state. The permanent-VPS Firefox proof also reloads the app and
checks that budget, active days, recipe choices and the resulting basket-backed
planner total are restored from the same persisted week.

## Milestone status — closed

M2 is technically closed on `main`. The deterministic planner → ingredient
mapping → one-store basket → shopping-list flow is implemented and has rendered
Firefox/geckodriver proof on the permanent VPS, including persisted planner
state after reload.

Do not reopen M2 for speculative feature work. The controlled fixture remains a
proof harness, not live-price evidence or a savings claim. Current product proof
work belongs to M3: trustworthy full-basket comparison against genuine observed
PLUS + DekaMarkt evidence.
