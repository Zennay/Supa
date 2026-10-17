# SUPA QA1 — Native GREEN CI evidence preflight (offline)

This is an **independent, read-only consistency audit**, not a release authorization or cryptographic authentication of GitHub. It pairs the native GitHub Actions `pull_request` run metadata, the **single** `test-build` job metadata, and the **original complete job log** for an exact immutable PR head and base revision. It intentionally complements the existing [expected-RED tool](./qa-native-red-ci-proof.md); it never replaces M3 retailer rights, actual in-store observations, or a verified SHA/job source.

The command performs **no network access**, shell launch, retailer request or file write. Download separately using an authorized GitHub source: a run JSON object (`GET /repos/Zennay/Supa/actions/runs/ID`), its matching job JSON (`GET /repos/Zennay/Supa/actions/jobs/JOB_ID` or the jobs list entry) and that job's decoded log. Save a private JSON object with `{"run":{...},"job":{...},"log":"..."}`, then:

```bash
node scripts/qa-native-green-ci-proof.mjs \
  --head=<exact-40-character-PR-head-sha> \
  --base=<exact-40-character-base-sha> \
  < private-native-job-evidence.json
```

**Requirements:** Node 22, max 16 MiB bounded UTF-8 JSON stdin. Exactly one matching PR run `status=completed`, `conclusion=success`, first attempt; job `test-build` completed successfully and tied to the same run ID; known six npm steps completed successfully in order with no extra npm execution. Native log must contain the exact `Merge HEAD into BASE` checkout, one TAP v13 summary with **all tests PASS** (no failure, skip, cancellation or todo), zero-vulnerabilities audit, explicit M1 matching and source-rights steps, **PLUS permission_required and DekaMarkt unresolved with both production flags false**, and a successful Vite build. Misordered, truncated, duplicate, foreign-SHA, UTF-8-corrupt and incomplete evidence refuses with generic stderr and **no output**.

Accepted output always has `outcome: native-green-evidence-consistent-not-authenticated`, `sourcePermissions: explicitly-denied-in-log`, `productionReady:false`, `publicSavingsClaimEligible:false`, `realStorePricesVerified:0`; no local source, row values, private labels, paths, prices or credentials are echoed.

**Important trust boundary:** locally submitted JSON and logs can themselves be forged. Independently inspect the GitHub API/UI for current run and job identity, run attempt, original protected merge checkout, signed evidence provenance and branch/merge permissions. No green Node test or successful build authorizes external supermarket crawling, publication, pricing or savings. SUPA M3 still requires external written PLUS/DekaMarkt rights [#74](https://github.com/Zennay/Supa/issues/74), one genuine ≤24-hour matched human 11×2 field pair [#78](https://github.com/Zennay/Supa/issues/78), pinned capture SHA [#205](https://github.com/Zennay/Supa/issues/205) and runner evidence [#2833](https://github.com/Zennay/Supa/issues/2833). No production ingestion while rights are unverified.