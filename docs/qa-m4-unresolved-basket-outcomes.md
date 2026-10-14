# SUPA M3→M4 basket evidence consistency — independent QA

Issue [#2075](https://github.com/Zennay/Supa/issues/2075). This add-only quality-validation probe was written against canonical `main=c36f5c8f71d77cae94663978b51a194e9b183af6`. No other QA/product/source owner branch is modified.

## Direct contract

The canonical M3 full-basket comparator returns `unknown` and non-claimable whenever a needed ingredient remains unresolved, rather than inventing a cheaper/same/more expensive result. In contrast, the M4 `basket_assessment_viewed` event currently accepts both a definitive `outcome` and nonzero `unresolved_line_count` as a pair, without cross-field validation. Its summary propagates the inconsistent outcome.

The standalone `tests/m4-basket-outcome-unknown-qa.test.mjs` uses the real exported M4 validator. Four positive controls preserve the valid semantics:

1. Missing products → `unknown`, eleven unresolved, no public claim or participant key.
2. Fully resolved basket events may record a private `better`, `same`, or `worse` outcome, **not** a public claim.
3. Zero unresolved alone does **not** prove a definitive result; `unknown` remains valid for other uncertainty.
4. Missing M4 basket evidence continues to yield `unknown` and a null unresolved count, never a fabricated positive result.

Six **expected-RED** cases (one missing line and eleven missing lines for each definitive outcome) demand fail-closed validation for every definitive outcome combined with 11 unresolved ingredient lines. `sessionOutcome='abandoned'` and a fictional `m3Gate.status='closed'` are synthetic test setup only, not assertions about actual research milestones.

## Safe owner handoff

Repair should be limited to coherence of a `basket_assessment_viewed` event, without fabricating money, dropping unknown outcomes, coercing nonzero unresolved counts to zero, or promoting public savings. Existing M4 `#151` timestamp owner and `#2049` integer safety lanes remain separate. Reconcile with the actual M3 report at the integration boundary. Require independently verified zCloud preflight/claim/lease, latest-main source replay, exact-head hosted CI plus applicable permanent VPS gates, owner review and human release authorization before any merge/deploy.

**DRAFT / HOLD / NO MERGE / NO DEPLOY.** Genuine same-demand PLUS+DekaMarkt evidence [#78](https://github.com/Zennay/Supa/issues/78) remains OPEN; M4 is not eligible. No retailer network or private participant data is used here.
