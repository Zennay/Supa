# Independent unchanged M5 HTML budget acceptance — 2026-10-14

Supa **M3 ACTIVE**, human 11-line PLUS+DekaMarkt same-demand 24-hour [field issue #78](https://github.com/Zennay/Supa/issues/78) OPEN. This is future-offline M5 static QA only, no M5 or production permission.

**Frozen corrected owner:** [product #2185](https://github.com/Zennay/Supa/pull/2185) exact `c14c2a3ce5de3500cc5dcd9488b180ccb55ad762`, child of #2184. This QA child adds only the *unchanged original independent tests* from [QA #2166](https://github.com/Zennay/Supa/pull/2166), frozen at `3c988af33d9921cc040da73ff40ebb67168c209b`, plus this provenance doc. Files retain original Git blobs:
- `tests/qa-m5-verified-html-byte-budget-20261013.test.mjs` **`b68dc2c691451f64e118b9395890cbdafdd29479`**, 4 cases.
- `tests/qa-m5-aggregate-html-byte-budget-20261013.test.mjs` **`a99f133e90462e168f83dc9d2cb1821a27507199`**, 2 cases.

Original source [CI #38485980241](https://github.com/Zennay/Supa/actions/runs/38485980241) was **759 total / 756 PASS / 3 intentionally source RED**, zero skip or other failures: 8 MiB+1 current, 8 MiB+1 baseline, and a **10 MiB aggregate from two individually <8 MiB files** were accepted. Valid small P2 and P1 controls were green. All source inputs are local invented SHA-valid HTML; no retailer network, prices, participants, credentials or rights.

**Important new owner-contract discrepancy to test, not prejudge:** product #2185 specifies **8 MiB per file but 32 MiB per capture tree**. Original QA #2166 expects an **8 MiB aggregate ceiling** (proposed conservative acceptance, not ratified by owner). Therefore both *can* be internally consistent at their own thresholds while the strict original 10 MiB aggregate test intentionally remains RED on product. Preserve original QA unchanged and capture exact outcome; escalate the discrepancy to original owners for an explicit final budget decision. Do **not** weaken or silently edit a RED case to claim source fix complete. A 32 MiB ceiling is not automatically a vulnerability just because QA proposed 8 MiB.

**DRAFT/HOLD/NO MERGE/NO DEPLOY** pending independent zCloud scope/write preflight+claim lease, original owners, full exact-head hosted CI, safe latest-main and applicable trusted VPS integration, real human M3 observations and releasego.
