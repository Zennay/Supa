# Private recipe drafts: explicit device-storage consent

Supa recipe drafts on a device are **opt-in**, unencrypted, local-only review records. They are neither user accounts nor cloud sync, approved recipes or retail prices.

The public product API `saveLocalRecipeReviewDraft(storage, id, draft, revision, consent)` now demands **exact primitive boolean `true`** before invoking any storage adapter. TypeScript type annotations do not survive a JavaScript, URL, HTML form or settings boundary; truthy values such as string `"false"`, number `1`, objects (including `{enabled:false}`) and boxed booleans never grant consent. Rejected input returns `{status:"consent_required"}` before calling `getItem`, `setItem` or `removeItem`.

The existing explicit true branch retains the canonical device draft schema, record revisions, client-row-ID stripping, removed source URLs and `needs_review` state. It does not silently save to an account or add prices. This correction does **not** solve cross-tab atomicity or stale delete/recreate revision #3295; that remains a separate open issue.

Test (fictional in-memory adapters only):

```bash
node --test tests/product-recipe-device-consent-primitive-20261016.test.mjs
```

The tests assert no storage adapter interaction for thirteen wrong-type/no-consent variants, positive primitive `true` save behavior and invalid-id rejection. Independently replay the **original unmodified** QA regression from [#3290](https://github.com/Zennay/Supa/pull/3290) to verify its four genuine expected RED cases become GREEN.

Source integration order is [parent #3285](https://github.com/Zennay/Supa/pull/3285), this product remediation, immutable peer QA acceptance, then authorized review/lease/appropriate CI. Supa remains M3 HOLD for written PLUS/Deka source rights [#74](https://github.com/Zennay/Supa/issues/74), real 11×2 human same-demand basket [#78](https://github.com/Zennay/Supa/issues/78), field SHA [#205](https://github.com/Zennay/Supa/issues/205), permanent trusted M3 VPS [#2833](https://github.com/Zennay/Supa/issues/2833). No deployment, retailer capture or public savings is authorized by this draft-storage fix.
