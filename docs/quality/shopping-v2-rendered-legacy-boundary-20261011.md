# Product-core acceptance: rendered shopping v2 legacy-storage boundary

**Scope:** Supa issue [#1056](https://github.com/Zennay/Supa/issues/1056). Add-only acceptance on top of [DRAFT #1539](https://github.com/Zennay/Supa/pull/1539) exact `c8c1dec7c782d1674bdc5c772cb757e7fd1cca84`. No edits to legacy v1 persistence, new v2 source, `App.tsx`, real prices, source permissions or `main`.

The new `tests/product-shopping-v2-rendered-legacy-boundary.test.mjs` imports the **actual** `ShoppingListViewV2.tsx` through Vite's real TSX transform and React server-renderer. It asserts:

1. Default initial render reads only the distinct v2 namespace, never silently migrates a valid legacy v1 snapshot.
2. With explicit migration opt-in, a v1 record from the exact current physical **and price** basket is reflected in rendered pressed state, but no v2 write happens during rendering.
3. With a 1-cent product repricing, the old v1 record is stale and cannot be migrated, while a valid previously created v2 record still retains checkmarks (price-independent physical task).
4. A present malformed v2 record takes precedence over a valid old v1 record: no fallback even with explicit legacy opt-in.
5. An authoritative valid v2 record is used regardless of unrelated v1 ticks; a different store rejects it.
6. Storage writes remain zero through every SSR render, including transitions and malformed data.

**Evidence boundary:** SSR validates rendered markup and initialization only. It **does not run React effects, clicks or localStorage writes**. Required next proof before owner integration: an actual browser/mobile click → persisted v2 → price refresh → reload sequence, changed-store/pack rebase, failed storage write warning, keyboard access, and evidence attached to exact run SHA on permanent VPS/Firefox. If the self-hosted checks queue, do not label them green.

**Release:** DRAFT / HOLD / NO MERGE / NO DEPLOY until original `#356/#422/#1058/#1532` owners and current-main integration review, verified zCloud write lease, hosted exact-head CI and permanent mobile/Firefox proof. M3 remains blocked by one real same-demand PLUS–DekaMarkt observation pair under [#78](https://github.com/Zennay/Supa/issues/78); synthetic fixture tests do not show real savings.
