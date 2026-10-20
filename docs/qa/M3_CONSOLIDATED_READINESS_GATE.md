# Supa M3 — independent consolidated readiness gate

This **quality-validation** tool is an operational, read-only **HOLD audit**, not a retailer-data importer or a release mechanism. Its inputs are the checked-out repository's immutable historical M1 fixtures, canonical source-permission evidence, and M3 workflow YAML. It never accepts arbitrary private observation files or network URLs.

## Run it in a checked-out current Supa commit

```sh
node --experimental-strip-types scripts/qa-m3-consolidated-readiness-20261017.mjs
node --experimental-strip-types scripts/qa-m3-consolidated-readiness-20261017.mjs --require-release
node --experimental-strip-types --test tests/qa-m3-consolidated-readiness-20261017.test.mjs
```

Use the project-supported **Node 24 with native TypeScript stripping** and `python3`/SQLite. Some host `/usr/bin/node` installations are built without TypeScript support despite accepting `--experimental-strip-types`; an `ERR_NO_TYPESCRIPT` there is an environment failure, not proof that the Supa code is defective. The existing GitHub Actions Node24 test/build job is the official exact-head validation.

## Checks actually executed

1. **Written source-rights evidence (issue #74).** Reads the exact current `evidence/m1/source-permission-gate.v1.json` with the independent QA documentary-rights auditor. A syntactically acceptable permission URL is not independent proof of retailer permission; even an underlying `productionReady:true` cannot turn this QA tool into a release token.
2. **Historical retailer quality.** Executes real six-source PLUS/DekaMarkt historical adapters through the reviewed SQLite builder, original-source exact fact parity, six-kind preflight and health check. Requires six snapshots, two retail chains, three approved source shapes per chain, no trusted current prices, `externalRequests:0` and private-only output. These checks are not a fresh product-price comparison.
3. **Permanent self-hosted PR trigger inventory (issue #2833).** Reads the actual `.github/workflows/m3-observed-week-report.yml` `on.pull_request.paths`, inventories current M3 source/test/dependency files and reports uncovered count. Static path coverage is **not** evidence that a particular permanent VPS run actually executed and was attested. Changes to that workflow remain under its source owner's exclusive control.
4. **Physical 11×2 human observation (issue #78), version pin (issue #205).** These are deliberately reported **unverified**. The gate does not read private customer carts or accept a source-controlled claim of a real in-store observation.

The four external human/runtime conditions always appear as explicit blockers. Missing workflow selectors add a fifth blocker, and unsafe documentary URLs add a further blocker. The report is stable JSON with anonymized counts and never emits original product labels, URLs, raw price cents, field records, evidence SHA or secrets.

## Exit behavior

| Invocation | Exit | Interpretation |
| --- | --- | --- |
| No arguments | `0` if the audit ran successfully | QA *inspection* completed; **still HOLD** |
| `--require-release` | `2` | Expected: independently verified M3 exit evidence unavailable |
| Unknown flags, malformed CLI data, broken parity or invalid workflow | `2` | Generic refusal; no successful audit/report on failure |

Do **not** wire the normal exit-0 to publishing, scraping, auto-merging, activating a scheduler or opening production. The only valid readout for release gating is `releaseDecision: "hold"`, `productionReady: false`, `allM3ExitGatesSatisfied: false` and `publicSavingsClaimEligible: false`.

This file is a QA runbook; it neither changes a retailer's license nor grants access to private APIs, authentication, CAPTCHAs or anti-bot bypasses. All fixtures are historical and reviewer-controlled. The correct next release steps remain written permission, same-demand paired 11+11 physical observation in one <=24-hour context, proof/code-pin capture, and a real appropriately authorized permanent self-hosted attestation.

## Verification snapshot (17 October 2026)

Isolated connected zSSH Node24 checkout of QA head `e78393c542874560546fbd841a7027542cec1519` passed **7/7 new native tests**. Combined with relevant original documentary rights, workflow-trigger, archived SQLite and source-integration suites: **56/56 PASS**. The real offline inspection observed six historical snapshots, 16 historical observations, `underlyingSourceGateClaimsReady:false`, `permanentRunnerMissingTriggerPathCount:286`, and release **HOLD**. This count is a live source-tree inventory, not a frozen contractual threshold; rerun before using a result. Hosted full native CI/audit/build on the final PR head is separately required. No production deployment, retailer HTTP or actual customer field evidence was involved.
