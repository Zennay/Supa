# M3 offline SQLite output path — fail-closed domain boundary

The private historical six-source SQLite generator exports both `buildReviewedRetailerSqlite` and `main(argv)`. A filename containing embedded NUL reaches Node's `fs.lstat` as an invalid argument; the resulting native `TypeError` includes the private supplied file path. That violates Supa's public API refusal contract even though it does not create a database.

`verifyNewFileTarget` now rejects invalid destination strings **synchronously before `path.resolve` and filesystem calls**, including blank, option-looking, excessive length and control characters (NUL, C0 and DEL). All such refusals raise the existing generic `Historical reviewed retailer import refused...` domain error rather than leaking a native filesystem diagnostic or path. Symlink ancestors, destination overwrite and restrictive on-disk importer behavior remain unchanged.

Tests:

```bash
node --test tests/product-m3-sqlite-target-domain-refusal-20261016.test.mjs
```

Checks use fresh synthetic OS temp folders and verify rejection before file creation for NUL/control paths, direct `main` emits no stdout, existing destination bytes remain identical and symlinked parents remain rejected. The original independent [QA #3242](https://github.com/Zennay/Supa/pull/3242) has two genuine expected RED cases; replay **unchanged** against fixed owner source. The underlying six-shape importer is still offline historical data only, and a created 0600 SQLite DB never certifies today's shop prices or licensed feeds.

The patch is an isolated child of [product owner #3235](https://github.com/Zennay/Supa/pull/3235). Parent and peer QA/main have not been changed. Integrate only with current-main review, scoped zCloud main-writer lease, applicable trusted VPS #2833 and real M3 requirements: written retailers rights #74, human PLUS11+Deka11 ≤24h same-demand comparison #78 and pinned field source SHA #205. No live retailer HTTP, production price or public savings enabled.
