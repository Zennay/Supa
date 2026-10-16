# Safe local recipe draft recovery across delete and recreate

Problem [#3295](https://github.com/Zennay/Supa/issues/3295): a local draft can be created at ID/revision `X/1`, deleted, and recreated at the same ID/revision `X/1`. A stale tab presenting only numeric revision `1` cannot be distinguished from the new record, so the old tab can overwrite/delete the unrelated replacement.

## Product boundary and compatibility

- Deleting a draft **removes the recipe contents**, replacing them with a tiny private `supa-recipe-device-tombstone` marker (version 1, opaque UUID nonce). `readRecipeDeviceDraft` continues to return `missing`; the marker does **not** retain title, steps, ingredient names, provenance URL, amounts or other recipe data.
- Recreating the **same ID** remains possible using `expectedRevision:null`, and the new record still starts at numeric revision 1 for the original API contract/QA. It is marked `reusedIdentity:true` with a fresh random UUID `incarnation`.
- A legacy stale call using only recycled numeric revision `1` is now refused with `conflict`. Subsequent legitimate updates/deletes on a reused ID additionally require passing the exact `expectedIncarnation` string retrieved from its current record. Old normal (never-reused) IDs remain compatible with their existing number-only revision interface.
- `restoreLocalRecipeReviewDraft` surfaces this optional incarnation, and `saveLocalRecipeReviewDraft` accepts it as a last optional argument, **after** the explicit primitive-true device consent argument from [#3314](https://github.com/Zennay/Supa/pull/3314).

This solves **deterministic ID/revision ABA** but is NOT a distributed/multi-tab atomic compare-and-swap: concurrent writes between final read and set still need a separate browser coordination mechanism. For normal UI flows prefer generating a new UUID on new draft creation rather than recycling deleted IDs.

The marker itself is private device metadata and should be removed by clearing Supa local device draft data. It is not account/cloud storage, encrypted persistence, or proof of reviewed ingredients. A corrupted/tampered tombstone is protected, never silently overwritten.

## Tests and independent review

```bash
node --test tests/product-recipe-device-incarnation-aba-20261016.test.mjs
```

This tests deletion privacy, stale update/delete refusal, valid tokenized reincarnation updates/deletes, safe restore and tampered marker rejection using only a disposable in-memory storage `Map`. Replay unchanged independent [QA #3292](https://github.com/Zennay/Supa/pull/3292) original 2 expected RED in separate review to prove RED→GREEN.

This is a private recipe module child of [#3314](https://github.com/Zennay/Supa/pull/3314) and [#3285](https://github.com/Zennay/Supa/pull/3285), NOT merged to `main`. It authorizes no real supermarket HTTP, pricing, customer savings or production. Written source rights #74, genuine same-demand 11x2 evidence #78, field code SHA #205, permanent runner #2833 and scoped zCloud writerlease/review remain M3 HOLD.
