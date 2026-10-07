# Contributing to SUPA

SUPA is currently in **M3 — Full-basket comparison & savings proof**. Contributions should preserve the project's evidence boundaries and keep validation reproducible.

## Before opening a pull request

Run the repository's standard validation path from a clean install:

```bash
npm ci
npm test
npm run m1:matching-benchmark
npm run m1:source-permission-gate
npm run build
```

If a change touches a path covered by an additional GitHub Actions workflow, that path-selected workflow must also pass on the exact pull-request head before landing.

Keep pull requests narrowly scoped. Do not overwrite or duplicate a file surface that is already actively owned by another open branch or pull request.

## Evidence rules

Mock data, generated fixtures, templates and synthetic observations are development/test material only. They must never be presented as genuine retailer observations, real basket outcomes or savings proof.

M3 is not complete until issue #78 has genuine, same-demand **PLUS + DekaMarkt** field evidence captured under the existing observation/conversion/assessment protocol. Better, same, worse and unknown are all valid observed outcomes; one observed week must not be generalized into a public savings claim.

Production retailer-data reuse remains separately permission/licensing gated even when a manual field observation succeeds.

## Security

Follow [SECURITY.md](SECURITY.md) for vulnerability reporting. Keep sensitive details, credentials and personal data out of public issues. SUPA does not authorize active testing, probing, scraping, bypassing controls or other intrusive interaction with third-party retailer systems without explicit authorization from the relevant system owner.

## Review discipline

A green test run is necessary but not sufficient for evidence-sensitive changes. Pull requests should state their product/evidence boundary, the exact head that was validated, and which hosted or permanent runner gates passed.
