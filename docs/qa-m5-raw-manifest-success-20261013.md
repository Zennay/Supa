# Independent M5 raw-manifest success contract (2026-10-13)

**Supa M3 ACTIVE, issue #78 real human same-demand 11 PLUS + 11 DekaMarkt observed basket pair OPEN.** M4/M5 not eligible. This is **synthetic local offline QA**, not a real source-terms, retailer, scraping, price, consent or release claim.

## Frozen source / ownership

New product [DRAFT #2157](https://github.com/Zennay/Supa/pull/2157), exact frozen source `1d0cd82365cd96c120ccddcc55297f280d80819e`, correctly validates boolean `source.success` in pure `captureShape`. However `scripts/m1-inspect-captures.mjs::inspectCaptureDirectory` first applies `Boolean(result.success)` to **raw manifest values**. Nonboolean raw `'false'`/ `'true'` and numeric success become canonical-looking booleans before the later pure validator can reject the original metadata. Synthetic SHA-valid local input can thus generate P2 human source-baseline review despite an impossible M1 `success` value.

New independently scoped [QA issue #2159](https://github.com/Zennay/Supa/issues/2159). QA-only frozen source branch `qa/frozen-m5-raw-success-1d0cd823-20261013`; QA branch `qa/m5-raw-manifest-success-20261013`. **Only new test and document paths**, not original owner `scripts/m1-inspect-captures.mjs`, product #2157, other worker source/QA, main or workflows. Owner retains fix of raw manifest validation before coercion.

## Executable proof

`tests/qa-m5-raw-manifest-success-20261013.test.mjs` invokes the **real Node M5 offline CLI** with a fresh temporary invented M1 manifest, local fictional HTML and an actual matching SHA256; verifies input is unchanged, no source identifiers in output and all production/eligibility/source rights/selector flags stay false.

Six independently named cases: two **positive** canonical true => P2 human baseline, canonical false => P1 failed capture; four intentionally **RED** groups requiring nonzero/generic private-safe refusal and no JSON output for raw `success:'true'`, `success:'false'`, numeric `1` / string `'1'`, and `null` / missing. No weakened assertions or fabricated current retailer data.

Require immutable QA HEAD hosted exact CI; expected 2 positives GREEN/4 intended source RED, no unrelated regression. On RED test workflows, npm audit can complete but *subsequent* M1/rights/build gates cannot be assumed GREEN. Future independently owned product fix must be tested by copying **the original unchanged test Git blob** to a new frozen source head and requiring all six GREEN, plus permanent applicable VPS, latest-main composition, independent zCloud preflight/write lease, owner reviews and explicit human releasego.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.**
