# Independent quality-validation — #2295 direct queue corrected-source replay

Source product owner [DRAFT #2301](https://github.com/Zennay/Supa/pull/2301), frozen initial SHA `384cb31d9e4d7475ce412c8db8b3a3dade96a4b0`, child of latest product evidence owner [#2296](https://github.com/Zennay/Supa/pull/2296).

This QA-only branch imports **exact Git blob `9f0a9b2ff1fd3f66d509f364248778af4bc5b165`**, unchanged from own earlier [QA original RED #2297](https://github.com/Zennay/Supa/pull/2297) (13 fictional tests: 8 originally RED, 5 positive). Strict SHA equality of the copied file is checked through GitHub; no assertions relaxed. No scripts, product, original QA branches, main, M1/M3/UI, workflow or permanent VPS edited.

**Expected proof:** direct queue rejects `candidate_observation` unless at least one JSON-LD descriptor successfully parsed on every verified current/historical side, while legitimate abstain, good fake Product, manual-only priorities, privacy and all rights/production flags remain. Both original and corrected paths must use their **own exact-head GitHub-hosted** tests, not inferred green.

At time of frozen child creation, source [#2301 original CI #38509381932](https://github.com/Zennay/Supa/actions/runs/38509381932) had three preexisting *product-positive mock* failures (same-HTML, metadata identity and unicode-provenance); their positive candidates encode zero parsed JSON-LD and no longer pass the stricter correct gate. These are owned by product-core, **not QA**. The new QA 13-case suite should be evaluated independently from those old positives. Do not merge a failing product or QA draft; use a new independently frozen product-head QA replay after owner's fixture correction.

Supa **M3 ACTIVE**, genuine [#78 PLUS 11 + DekaMarkt 11 same-demand field evidence](https://github.com/Zennay/Supa/issues/78) still missing; M4/M5 not release eligible. **DRAFT/HOLD/NO MERGE/NO DEPLOY** pending verifiable zCloud SQLite task/scope write lease, original product/QA review, exact hosted audit/M1/build and current-main/trusted runner if relevant, human field proof and explicit releasego.
