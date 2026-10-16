# Private recipe portion scaling — copy mutable review metadata

Scaling a local recipe to a new serving count must not change the original recipe, either immediately or through later user edits on the returned result. The generic scaler already copied top-level fields and ingredient rows but accidentally shared the source `steps` and `warnings` arrays. This could let editing cooking instructions or appending review remarks on the scaled draft mutate the original.

Both success and unknown-serving/error review paths now detach those standard mutable arrays when present. The copy is shallow **by design for the ordinary string steps/warnings** the product owns; it does not broaden unrelated input parsing or assert deep cloning of arbitrary user objects. No ingredients, original cooking steps, or global provenance messages are discarded. Frozen source drafts remain supported.

```bash
node --test tests/product-recipe-portion-metadata-detachment-20261016.test.mjs
```

The four synthetic tests cover successful scale, unknown servings, frozen source inputs and portion-only generic objects. Replay original immutable [QA #3281](https://github.com/Zennay/Supa/pull/3281) two expected RED cases against the fixed owner source for independent acceptance. Work is an isolated child of [product parent #3268](https://github.com/Zennay/Supa/pull/3268); no other recipe owner or QA files are edited.

This does not grant external retailer price rights or public publication. M3 still requires written sources #74, genuine PLUS11/Deka11 24-hour evidence #78, field-code SHA #205, trusted runner #2833 and zCloud scoped main writer lease/review before merges or deployment.
