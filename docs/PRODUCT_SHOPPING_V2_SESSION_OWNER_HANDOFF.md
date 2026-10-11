# Product-core handoff — ShoppingList v2 session bridge (#1056)

## Scope
This is **additive product code**, built on immutable [#1058](https://github.com/Zennay/Supa/pull/1058) `797238838656ea06eb8a405532eebd6347f23167`. It does **not** touch the current v1 `ShoppingListView.tsx`, the existing `shoppingListProgress.ts`, or another owner branch. It is a render-independent transition layer for the original UI/feature owner to review before wiring.

## Why
The existing v2 utilities support price-independent physical basket identity, but the UI must coordinate **three events** without guessing storage validity: first load (possibly opt-in v1 migration), a changing basket prop, and a user tick. Using the old basket reference after an in-place mutation could make two comparisons accidentally observe only the *new* state. This layer pins the old identity string at the last accepted state.

## API
- `startShoppingProgressSessionV2(basket, rawV2, { rawV1, allowLegacyUpgrade })`: v2-first recovery. Legacy migration only with explicit opt-in and *absent*, not invalid, v2 snapshot. Return current checked IDs and a serializable snapshot.
- `rebaseShoppingProgressSessionV2(session, nextBasket)`: preserve checks on price-only/display-only refresh; reset on physical task change, even if a caller mutated the old basket **in place**.
- `toggleShoppingProgressSessionV2(session, currentBasket, lineId)`: first reconcile the current task, then toggle only an existing line ID; never resurrect old checks.
- Each returned state has `demandIdentity`, `completedLineIds`, `serialized` and `upgradedFromLegacy`. A null identity/snapshot must never be persisted.

## Optional storage adapter (production module)
The additive `shoppingListStorageControllerV2.ts` can supply the UI with a bounded storage lifecycle without direct `localStorage` calls in rendering code.

```ts
// Inside a once-only effect/event owned by the ShoppingListView maintainer:
const controller = openShoppingProgressStorageV2(currentBasket, window.localStorage, {
  allowLegacyUpgrade: false, // only opt in after reviewing legacy migration
})
const first = controller.snapshot()
const repriced = controller.rebase(nextBasket)
const checked = controller.toggle(ingredientId)
const persisted = controller.persist() // call after user action/effect, not render
```

The adapter reads only v2 when present, never falls back to v1 if v2 is malformed, and reads v1 only by explicit opt-in and absent v2. It stores only the v2 key, never silently overwrites v1. Blocked/private browser storage or quota errors are caught; session checkmarks still function in memory but `persist()` returns `false`. Invalid basket identities never persist. Snapshot arrays are copied to prevent external mutation from changing internal session state. Initialization performs **zero writes**. Rendering/React lifecycle wiring and accessibility acceptance remain with the original view owners.

## Owner integration (NOT done here)
The current view owner [#422](https://github.com/Zennay/Supa/pull/422) and v1 progress owner [#356](https://github.com/Zennay/Supa/pull/356) must decide if/how to adopt this new module. On mount read the v2 namespace first, optionally opt into strict v1 migration only when the v2 key is absent, then write `session.serialized` to the **v2 key only** after valid transitions. On basket prop change, rebase with the last immutable session snapshot; on checkbox click, toggle against the current basket. A legacy v1 price-dependent key remains a separate incompatible schema. No persistent write should be done from a React render.

## Executable product verification
`node --experimental-strip-types --test tests/product-shopping-v2-session-transitions.test.mjs`. Cases: actual one-store repricing and restored checkmarks, **in-place** mutated physical pack identity (pinned snapshot), changed store/product/week, same-session toggle, explicit v1 migration and v2 precedence, invalid basket refusal and input immutability. All fixture prices are synthetic and make no savings/retailer claim.

## Hold gates
Require exact-head hosted npm ci/audit/tests/benchmark/permission/build, relevant rendered Firefox + VPS mobile checks, verified zCloud lease/owner review, safe current-main integration. Until then: **DRAFT / HOLD / NO MERGE / NO DEPLOY**. Real M3 same-demand PLUS and DekaMarkt observation [#78](https://github.com/Zennay/Supa/issues/78) remains the product evidence gate.
