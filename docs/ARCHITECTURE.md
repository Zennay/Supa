# SUPA architecture baseline

## Why this baseline exists

The graduation work already established a planner-first product flow. The recent Astra/Work direction was to begin a modern mobile-first implementation without throwing away that architecture.

This repository therefore starts with a deliberately thin frontend foundation while the Senior Team validates the hardest dependency: current supermarket data.

## Boundaries

### UI / features

`src/features` owns user-facing flows such as planner, basket and shopping list. Feature components should not scrape, normalize or invent price truth.

### Domain

`src/domain` owns stable product concepts and pure rules. Domain code must stay independent from React and supermarket-specific source quirks.

### Data boundary

`src/data` currently supplies mock fixtures. It will become the frontend-facing repository/API boundary.

Real data should eventually flow through:

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

Those are gated by M1/M2 evidence, not by UI readiness.
