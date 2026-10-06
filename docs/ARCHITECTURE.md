# SUPA architecture baseline

## Why this baseline exists

The graduation work established a planner-first product flow. The executable product has since closed the bounded M1 data-feasibility gate and the M2 planner-to-basket vertical slice.

The repository is now in M3: prove trustworthy full-basket comparison with genuine same-demand PLUS + DekaMarkt observations while keeping production retailer-data reuse behind explicit permission/licensing gates.

## Boundaries

### UI / features

`src/features` owns user-facing flows such as planner, basket, observation collection and shopping list. Feature components should not scrape, normalize or invent price truth.

### Domain

`src/domain` owns stable product concepts and pure rules. Domain code must stay independent from React and supermarket-specific source quirks.

### Data boundary

`src/data` contains controlled fixtures plus source-specific normalization/adapters used by the bounded M1 proof. Mock data remains isolated from evidence-bearing paths. Production automated retailer-data reuse is not implied by technical capture success and stays permission-gated.

Evidence-bearing product data flows through:

```text
supermarket adapter
  -> raw source snapshot
  -> normalization
  -> canonical product/price/offer records
  -> ingredient/product matching
  -> basket engine
  -> application API
  -> web/PWA
```

## Required invariants for real data

1. No price without source and observed-at timestamp.
2. No savings number without a defined baseline.
3. Matching uncertainty must remain visible.
4. A basket calculation must be reproducible from its input snapshot.
5. User choice overrides optimization.
6. Stale/unavailable sources degrade honestly.

## What is intentionally not here yet

- production authentication;
- complex backend infrastructure;
- all-supermarket ingestion;
- opaque AI/ML matching;
- public savings claims;
- large-scale recipe ingestion.

Those are gated by the current M3/M4 proof sequence and by explicit source/rights constraints, not by UI readiness.
