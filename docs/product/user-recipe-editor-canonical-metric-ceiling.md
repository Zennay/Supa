# SUPA private recipe editor — canonical metric boundary

The pure importer `src/domain/userRecipeImport.ts` treats normalized physical quantities above **1,000,000** g, ml or pieces as unresolved rather than silently accepting implausible shopping demands. The manual editing path was less strict: its number parser and final confirmation gate admitted quantities up to 1,000,000,000.

The editor now shares the importer's **1,000,000 normalized unit** ceiling in both `parseMetricEditorAmount` and `validAmount`; `updateEditorIngredient` marks excessive edits as `reviewReason` instead of treating them as reviewed. The user's original numeric value remains in the editor model for manual correction. Even a direct caller forging `reviewReason:null` cannot bypass `canConfirmUserRecipeDraft`. Ordinary positive values, the inclusive 1,000,000 boundary and Dutch decimal-comma values remain supported. No false zero or speculative price is produced.

Run the isolated test suite:

```bash
node --test tests/product-recipe-editor-importer-quantity-parity-20261016.test.mjs
```

Repeat the original **byte-identical** independent [QA #3286](https://github.com/Zennay/Supa/pull/3286) previously hosted expected RED test source against the fixed owner's latest SHA before review/merge. These changes deliberately do not modify the importer, the separate portion/scaling owner, private recipe UI composition or any other worker's tests.

This parent [editor PR #3274](https://github.com/Zennay/Supa/pull/3274) remains draft and must integrate before the correction. Actual M3 external supermarket permissions #74, real PLUS11+Deka11 ≤24h field evidence #78, code SHA #205, permanent trusted VPS #2833 and zCloud writerlease stay HOLD. No retailer HTTP, current prices, public savings or deployment.
