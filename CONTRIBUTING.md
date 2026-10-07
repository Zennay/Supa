# Contributing to SUPA

SUPA is an evidence-gated grocery-planning product. Contributions must preserve the distinction between executable product behavior, controlled fixtures, and genuine retailer/user evidence.

## Before proposing a change

Use Node 22 and the locked dependency graph.

```bash
npm ci
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

If your change touches a path with a dedicated GitHub Actions workflow, require the path-selected workflow to pass on the exact PR head as well. Do not reuse validation from an older commit after the branch changes.

## Scope and ownership

- Check open pull requests before editing a file that may already have an active owner.
- Keep changes inside the smallest coherent scope.
- Record the exact head SHA and the validation run(s) used to justify landing.
- Do not overwrite or absorb another active worker's branch without explicit coordination.

## Evidence boundary

Mock, generated, deterministic, replayed, or fixture data is useful for tests, but it is **not** genuine retailer evidence and is **not** proof of savings.

M3 remains open until the genuine same-demand PLUS baseline + DekaMarkt candidate field observation under GitHub issue #78 is collected and accepted by the canonical converter/assessment path. Better, same, worse, and unknown are all valid outcomes.

Do not strengthen public savings claims from controlled fixtures, generated artifacts, graduation scenarios, or one-off synthetic comparisons.

## Retailer-data permission boundary

Production reuse of retailer data remains permission/licensing gated. Repository tooling and public-page fixtures do not authorize scraping, bypassing anti-bot controls, authenticated access, private API use, or other active testing of third-party systems.

## Security findings

Do not put credentials, personal data, receipt images, exploit details, or other sensitive material in a public issue. Follow [SECURITY.md](SECURITY.md) for vulnerability reporting and authorized-testing boundaries.
