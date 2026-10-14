# Independent corrected permanent-runner fork-admission QA — 14 October 2026

## Exact-head source/QA provenance
- Existing original [security finding #365](https://github.com/Zennay/Supa/issues/365): a public fork PR must not run untrusted checkout/build/browser code on persistent VPS `vps-bb300bba`. Separate M2/mobile QA owner [#523](https://github.com/Zennay/Supa/pull/523) covers other paths.
- Original product owner [DRAFT #2167](https://github.com/Zennay/Supa/pull/2167), **frozen independently reviewed corrected source HEAD `b867b90ac480060599473818181e8e2257272a2a`**, now includes a job-level `if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository` **before** `runs-on: self-hosted`, retaining trusted same-repository PR and manual `workflow_dispatch`. Product owner, not QA, wrote this fix; **no VPS actions or deployments were executed in this QA replay**.
- Earlier isolated independent QA [DRAFT #2175](https://github.com/Zennay/Supa/pull/2175) on frozen unguarded owner source `91a090d483cf988b0ea735e5be8a5fd3a14f008d` proved [original hosted CI #38488824592](https://github.com/Zennay/Supa/actions/runs/38488824592): **682 tests / 681 PASS / 1 intended source RED**. The guard was genuinely missing on that source.
- Important QA harness correction: original static `jobHasSafeAdmission()` erroneously demanded the `if:` as the **very first** line after job name, refusing harmless **indented YAML comment lines** before the true job-level guard. Own QA changed only the test parser to tolerate such comment lines with a new positive fixture (still requires the *exact guard on a job property directly before `runs-on: self-hosted`*; missing and step-level guard fixtures remain negative). This is an **own-test false RED fix**, not product/source permission weakening. The corrected source tree is frozen and the identical corrected test blob copied to this QA green replay.
- Exact corrected original-QA test Git blob SHA256: `2d51c50470941a7d2361ab3d98d07c2434545173`. This same blob is on both isolated QA source-expectation branches.
- Exactly **two ADD-only paths** on a new isolated QA branch from fixed product `b867...`: that byte-identical test and this independent provenance document. Product PR, original QA PR, main, workflows, retailer source, other workers remain untouched.

## Contract tested
1. Canonical job-level guard with no comments, and the equivalent guard preceded by harmless job-level comments, must both pass.
2. Missing guard or step-level-only `if` must fail; an untrusted fork is not allowed to allocate the permanent self-hosted runner.
3. Corrected product workflow retains `pull_request` for same-repo, manual trusted `workflow_dispatch`, read-only `contents:read`, `persist-credentials:false`, exact permanent hostname and loopback-only Vite/WebDriver, 15-minute timeout.
4. The one actual permanent job has the required guard on the **job itself**, before `runs-on:self-hosted`; no `pull_request_target`, no new privileges or dispatch performed.

Original unguarded source should continue **RED** even after the QA-only parser correction. Separately corrected owner source should produce **all GREEN** on exact new QA HEAD with `npm ci`, audit-high, M1 matching/source permission gate and TS/Vite build. Never substitute an earlier owner-only CI run for this independent exact-head replay. Github-hosted static QA is not actual permanent VPS functional or source authorization proof.

## No release
Supa **M3 ACTIVE**, genuine human same-demand 11-item PLUS + 11-item DekaMarkt observed within 24h [#78](https://github.com/Zennay/Supa/issues/78) OPEN. M4/M5 ineligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud SQLite task/scope/write preflight+claim/lease, relevant original owners, latest-main composition, trusted permanent VPS/browser where safe and explicit human releasego.
