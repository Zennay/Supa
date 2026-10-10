# Physical trust boundary before v2 shopping-progress integration

Status: **pre-integration product-core**; Supa M3 remains active. This
adapter fixes neither the existing ShoppingListView nor genuine observed prices.

Existing product owner [#1058](https://github.com/Zennay/Supa/pull/1058)
keeps the price-stable v2 identity/storage contract. Existing UI owner #422
and legacy v1 owner #356 keep their files. This stack adds **new files only**.

## Why a second gate?

The v2 identity is rightly independent of product prices, but by itself
accepts a structurally plausible 150 g requirement matched to a 1 l package
or a fabricated number of packs. A key is not proof that the basket's actual
physical shopping task is valid. See [#1091](https://github.com/Zennay/Supa/issues/1091)
and independent negative QA #1090.

The pure `isTrustworthyShoppingBasket()` checks physical pack family and
minimum pack count, finite normalized quantity, valid cents (including real
zero-cent prices), checked-current basket counts, duplicate row identities
and exact basket sum before the v2 read/write/toggle/upgrade APIs run.

`shoppingListTrustedProgressV2.ts` exports pre-validated wrappers for the
existing owner's five operations. Product prices are checked as **data**
but are **not included in the v2 task identity**: valid repricing preserves
existing checks; an invalid or stale monetary basket cannot persist/restore
checks until the current basket is fixed.

## Owner handoff

- In owner #1058 / #422, adopt the trusted wrapper functions as the only
  storage, reload, toggle, same-session reconciliation and explicit v1 upgrade
  entry points; ensure the live ShoppingListView is wired to v2, and
  update the legacy price-change-reset test only after the actual UI changes.
- Keep v1 upgrade explicitly opt-in, only for an exact valid old price-sensitive
  key. Never reinterpret v1 under v2.
- Keep true demand changes, missing products and underfilled/corrupt packs
  unchecked, and show helpful correction copy; do not silently mark complete.
- Verify exact-head hosted CI and independent permanent Firefox/mobile
  acceptance before integration. These source modules alone are **not a
  rendered product release**.
- Avoid using the monetary or shopping-progress check as price-source
  approval. Real PLUS/DekaMarkt same-demand field evidence within 24 hours,
  M3 issue #78, remains mandatory.

The arithmetic check uses **no subtractive epsilon**. Authentic fractional
aggregation must be fixed upstream in #1053 with original per-meal
quantities; a new source with already-drifted `0.30000000000000004` demand
must not be silently rounded to exactly 0.3.
