# Supa recipe serving preview: preserve original review warnings

Changing a recipe's serving count may yield perfectly valid scaled numeric quantities without resolving uncertainties from the **original imported recipe, provenance, or unit conversion**. The existing private shopping preview correctly blocked pending source warnings, but the composed portion-preview gate ignored them.

`previewLocalRecipePortions` now retains the caller's `warnings` array in its cloned draft and explicitly treats any nonempty source-level warning list as requiring human review, regardless of whether the metric scale returned `scaled`, a source HTTPS URL is well-formed, or all ingredient rows happen to pass final editing checks. An absent/malformed warnings list fails closed. Warning-free manual recipes can still display their scaled quantities as review-clear if all other existing gates pass.

**No automatic fetch, no cloud storage, no retailer verification, no price or savings.** The original input remains unchanged and the existing shopping preview remains blocked when unresolved source warnings exist.

```bash
node --test tests/product-recipe-portion-global-warning-20261016.test.mjs
```

Independently replay the original **byte-identical** QA from [#3289](https://github.com/Zennay/Supa/pull/3289) against corrected product head for RED→GREEN acceptance; no changes to peer tests or other workers' recipe import/scaler components. Child is stacked on product consent fix [#3314](https://github.com/Zennay/Supa/pull/3314) and original recipe integration [#3285](https://github.com/Zennay/Supa/pull/3285). Main integration requires applicable CI/review, scoped zCloud SQLite writerlease, relevant VPS #2833 and still missing M3 source rights #74, observed two-store matched basket #78 and field SHA #205. This is not a production/release permission.
