# Shopping checklist v2 — price-stable physical task (pre-integration)

**Status:** Independent product-core staging for [#1056](https://github.com/Zennay/Supa/issues/1056). NOT yet wired to the customer-visible ShoppingListView. Keep in draft until owners review. Canonical SUPA milestone stays M3; this is not retailer/savings evidence.

## Bug and contract

The current v1 `shoppingListBasketKey()` includes `pricePerPackCents` and `lineTotalCents`. A one-cent product-price refresh therefore clears already checked groceries in the same session and after reload. A financial refresh does **not** change what the student needs to pick up.

New isolated modules:

- `src/features/shopping-list/shoppingListDemandIdentity.ts`: validated v2 identity of *store + canonicalized line ids + requirements + match decision + product identity + whole-pack shopping quantities*. Ignores money, labels, match scores, and explanation text.
- `src/features/shopping-list/shoppingListProgressV2.ts`: explicit v2 local-storage namespace, fail-closed serialize/restore and same-session reconciliation. It **never** interprets or upgrades v1 persisted JSON.

### Expected behavior

| Transition | Checked list |
| --- | --- |
| Price changes while all physical purchase decisions remain equal | Keep checked items |
| Product label, confidence, or trace text changes only | Keep checked items |\n| Shopping rows are reordered for presentation | Keep checked items |
| Store changes | Reset |
| Recipe demand changes quantity or line count | Reset |
| Different selected product, packs, or pack size | Reset |
| Matched ↔ unresolved line | Reset |
| Unknown/malformed runtime basket or unmatched old v1 state | Ignore persisted state |\n| Explicit legacy v1 migration for an exactly identical priced basket | May safely transfer current checked items into a v2 record |
| User starts an empty week | Never resurrect previous checkmarks |

The v2 identity sorts projected shopping lines by validated stable id, unlike v1. This preserves user progress when rows are reordered but still resets on removed/added lines or changed actual quantities. It also treats a genuinely different fractional demand as different, rather than rounding quantities to hide a mismatch.

## Owner-controlled wiring plan

- After [#356](https://github.com/Zennay/Supa/pull/356) lands its runtime validation, import the v2 identity and serialize/restore helpers into the current shopping persistence implementation or adopt the adapter as appropriate. Do not delete its existing fail-closed runtime checks.
- Update the `ShoppingListView.tsx` owner ([#422](https://github.com/Zennay/Supa/pull/422)) to calculate component `basketKey` from `shoppingListDemandIdentity(basket)`; when null, expose unchecked state only and do not persist. Use `reconcileShoppingProgressV2(previousBasket,nextBasket,done)` for same-session state transitions if not using the identical v2 key as React state key. Use `toggleShoppingProgressV2(basket,done,lineId)` for click transitions; it refuses malformed baskets and phantom line ids while de-duplicating valid state.
- Read/write only `shoppingListProgressV2StorageKey` for v2 snapshots. Existing v1 localStorage may remain untouched (separate namespace). **Explicit opt-in migration:** `upgradeLegacyShoppingProgressV1(basket, rawV1)` returns a v2 JSON snapshot only if the exact old price-sensitive basket key matches the current basket. This preserves valid old checkmarks without guessing after price/product/store changes. The UI owner may call it once **only when v2 is absent**, then persist its return value under the v2 key. Never reinterpret v1 records as v2 or automatically trust stale legacy data.
- Refresh `tests/shopping-list-progress.test.mjs` (currently owned by #422) to assert price-only change preserves checked items while store/pack/status changes reset. Add rendered browser proof for both same-session repricing and a reload with the updated price; preserve screen-reader `aria-pressed` semantics.
- Confirm exact-HEAD hosted CI, permanent VPS/mobile, and Firefox rendering before coordinated landing. Run with controlled fixtures; never claim real PLUS or DekaMarkt observations.

## Regression coverage in the staging PR

`tests/product-shopping-demand-identity.test.mjs` proves one-cent repricing, mutation boundaries, empty demand, malformed values, stability/immutability.

`tests/product-shopping-progress-v2.test.mjs` proves v1→v2 rejection, persistent reload with repricing, same-session preservation, order-insensitive progress, safe click toggles, explicit exact-match legacy migration, cross-store/product/pack/demand reset, malformed data filtering and empty week. Tests use only fixed M2 fixtures, not live retail price feeds.

## Open proof gate

[#78](https://github.com/Zennay/Supa/issues/78): one authentic PLUS baseline and DekaMarkt candidate for the exact same demand, captured within 24h in a shared pricing context. This implementation does not change M3 completion status or enable savings claims.
