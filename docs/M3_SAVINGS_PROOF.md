# M3 savings-proof contract

M3 asks one narrow question: **does the same planned week have a trustworthy full-basket financial difference at a second store?**

## Baseline

The baseline is the complete basket for the exact same selected week at one explicitly named baseline store.

For a comparison to be claimable:

- both baskets must represent the same selected meal count;
- both baskets must contain the same ingredient requirements (same IDs, amounts and units);
- every requirement must be resolved at both stores;
- every matched line must have a valid pack/price trace;
- each basket total must equal the sum of its matched line totals;
- baseline and candidate stores must differ.

If any of those conditions fail, the comparison returns `direction: unknown` and no savings delta.

## Delta

`deltaCents = baselineTotalCents - candidateTotalCents`

- positive: candidate store is cheaper;
- zero: same total;
- negative: candidate store is worse.

Negative outcomes are retained as evidence. SUPA must not hide them by only surfacing winning baskets.

## Effect attribution

M3 tracks three effect buckets:

- pack-size effect;
- offer effect;
- planning effect.

Each effect may be an integer-cent measurement or `null` when unknown. The comparison exposes the remaining unexplained delta instead of inventing an attribution.

## Evidence boundary

The first M3 fixture is controlled deterministic data. It proves comparison/calculation behavior only.

It **does not** prove real-world savings, live supermarket prices or production reuse permission. Public/product savings claims require observed weekly baskets collected under the existing source-permission and provenance gates, including cases where SUPA is worse or cannot decide.
