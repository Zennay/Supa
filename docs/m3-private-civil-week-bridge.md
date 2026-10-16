# Strict private retailer captures → selected-week review

This optional M3 product-core feature connects the **six fixed sanitized historical PLUS/DekaMarkt fixtures** to the current real meal-plan/ingredient aggregation and a separate human review row for each retailer. It is a bounded end-to-end private operator path, not a scraper, source license, checkout quote, savings claim, or source of current grocery prices.

Run from repository root (Node version from the repo tooling):

```sh
node --experimental-strip-types scripts/retailer-private-civil-week-bridge.mjs
node --experimental-strip-types scripts/retailer-private-civil-week-bridge.mjs --days Ma,Do
node --experimental-strip-types --test tests/product-private-civil-week-bridge-20261016.test.mjs
```

The CLI returns **aggregate counters only**: six archived sources, count of historical product groups, selected planned days, unique ingredient needs, review rows and unresolved/manual-review counts per store. It emits no product names, prices, URLs, participant details, source hashes, credentials or capture times. It performs no HTTP and accepts no custom source paths, dates, fixture arguments, price overrides or output paths.

Pipeline: `readBoundedRegularReviewedFixture` (six allowlisted files) → `buildCivilClockCheckedPrivateCatalog` (strict inert snapshot, UTC−12/+14 civil bound, nanosecond physical duplicate, source URL, six-adapter atomic admission) → `buildDynamicReviewedWeek` (canonical M2 user-selected real recipe days and exact aggregated ingredient quantities) → **historical-only two-store review queue**.

The exported private API also accepts an **optional third argument** `{ plan, recipes }` for a bounded, real local user plan. Both inputs are copied through the inert JSON boundary (no Proxy/getter/prototype execution), and duplicate days, missing recipes, invalid demand and extra option keys fail closed. Valid Dutch weekdays `Ma`–`Zo` can be selected when the custom plan genuinely contains meals for them. For example, adding a Friday Tikka recipe to Monday and Thursday aggregates the three chicken demands to **900 g**, rather than recycling a fixed 11-line sample. The fixture-only CLI deliberately stays restricted to days with existing M2 example meals; it does **not** accept arbitrary external recipe files.

The safe result holds a `privateReview` object for an explicitly authorized local UI/worker consumer and a redacted `summary` (including `selectedPlanSource`); only the summary is printed by the CLI. The private review is not licensed data and may not be published as a current retailer quote.
The new exported `buildCivilClockCheckedPrivatePlannedWeek(records, days, options?)` is opt-in, not a replacement for current ingestion. For any invalid physical source, impossible civil clock, duplicate capture, bad day selection, failed adapter or malformed returned queue it **throws without producing any partial result**. Tests assert atomic refusal, copied source immutability, recipe-demand recomputation and redaction.

## Limits / activation

- `productionReady: false`, `sourcePermissionVerified: false`, `publicSavingsClaimEligible: false`, `livePricesAvailable: false`, `externalRequests: 0` are invariant.
- **Not a fix for authoritative six adapter callsites** or the direct universal catalog entrypoint. Independent P1 #3692, #3695, #3701 and rights gate #74 remain separately owned/unresolved until integrated and proven.
- External M3 exit remains the actual same-demand 11×2 field capture #78, written source permission #74, pinned field code SHA #205, and trusted runner #2833. No live request, scheduler, VPS activation or public savings claims.
- This add-only branch is stacked on product PR #3706's frozen `6229329c261b5ad7f158d39f1938cd40a6f68b4d`. It does not modify #3706's original four files, independently owned QA suites, main, or the source/permissions registry.
- Keep the pull request **draft/nonmerge** until an authorized zCloud scoped source/task and protected-main merge lease, current-base integration and exact-head native CI are verified. CI proof is branch/commit-specific.
