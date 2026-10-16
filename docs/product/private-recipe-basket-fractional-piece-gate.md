# Private unpriced recipe basket — physical fractional pieces

The approved private metric portion scaler marks a fractional physical `piece` (for example 0.5 onion or 1.5 eggs) as requiring **human review**. Direct `prepareUnpricedPrivateRecipe` previously accepted that same fraction as a ready-to-shop unpriced ingredient if the editor row otherwise looked complete. It must never bypass the scaler's physical-piece review policy.

The offline basket bridge now adds machine-readable `fractional_piece_needs_human_review` whenever `unit === 'piece'` and the numeric quantity is nonintegral. A `review_required` result includes no recipe projection. Exact integer pieces remain eligible. Legitimate decimal gram and millilitre values remain **unpriced** with `estimatedCost:null`, `priceStatus:'unknown'`, never false zero/currency or supermarket comparison.

Test the pure synthetic scenarios:

```bash
node --test tests/product-private-recipe-basket-fractional-piece-20261016.test.mjs
```

The tests check six fractional-piece quantities, two whole pieces and decimal gram/ml positives. Original independent [QA #3296](https://github.com/Zennay/Supa/pull/3296) three proven expected RED are to be replayed byte-identically on this product source. The original basket owner [#3291](https://github.com/Zennay/Supa/pull/3291) and the portion-scaler owner/QA remain unchanged.

This change is a narrow **review gate**, not automatic fractional-ingredient rounding, customer instruction, live retailer price or user-ready production launch. Supa M3 remains HOLD for #74 signed permissions, #78 human same-demand 11×2 field evidence, #205 field-code SHA, #2833 permanent trusted VPS and scoped zCloud main writer lease/review.
