# Compound recipe measurements: never undercount an ingredient

A local recipe ingredient such as `1 kg 250 g bloem` previously parsed as only `1 kg` with a mistaken label `250 g bloem`. That can silently understate a future shopping-list quantity, even though the recipe is currently unpriced/private.

`normalizeIngredientLine` now recognizes **two consecutive amount+known-unit pairs** before its ordinary single-unit parser. When both units normalize to the same physical dimension and the combined result remains within the existing canonical `<=1,000,000` range, it sums using the existing g/ml/piece factors and 0.001 granularity. Examples: `1 kg 250 g` → `1250 g`, `1 l 250 ml` → `1250 ml`, `1 lb 4 oz` → approximately `566.99 g`. It preserves the real food name, original line and normal `needs_review` recipe draft state. Single-unit amounts are unchanged.

When a compound is cross-dimensional, too large, malformed or contains a **third** recognized amount/unit, the parser now returns `amount:null, unit:null` with an explicit human-review reason. It does **not** trust only the first segment, guess a zero, create prices or fetch any recipe URL. The JSON-LD entrypoint consumes HTML that an independent approved boundary would have already supplied. No network is used here.

Run:

```bash
node --test tests/product-recipe-compound-units-full-normalization-20261016.test.mjs
```

Original immutable independent [QA #3271](https://github.com/Zennay/Supa/pull/3271) has five genuinely hosted expected RED and should replay byte-identically against the fixed owner SHA. The standalone product importer owner [#3264](https://github.com/Zennay/Supa/pull/3264), other recipe editor/scaler workers, QA and `main` have not been modified.

This does not establish retailer source rights, field prices, or public savings. M3 remains blocked by written PLUS/Deka permission #74, real human matched 11×2 basket #78, field collector code pin #205, permanent trusted runner #2833, scoped zCloud SQLite writerlease and review.
