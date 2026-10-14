# SUPA M3 — current-main, source-byte-identical dual-owner integration QA

## Purpose and ancestry

Notion **PWQ-325** explicitly prioritizes integrating existing M3 user-flow fixes over starting new M5 work. This is an **isolated, non-deployable quality-validation branch** assembling two already-owned current-M3 corrections, **not a new product-owner implementation**. No file of either owner's branch, any other QA branch, main, VPS, real user or retailer source was modified.

Exact canonical `main` before assembly: `c36f5c8f71d77cae94663978b51a194e9b183af6`. Both source-owner PRs independently compare against it as **3 ahead, 0 behind**, with **different production filenames**, so this temporary Git tree is a literal union of the original six Git blobs, **without reimplementing or changing any byte**:

| Path | Immutable original owner/QA PR | Git blob SHA |
|---|---|---|
| `scripts/m3-assess-observed-week.mjs` | product #2111 | `dcf8ddf2a265d2dbcc7668cc6de85dcd12f8f575` |
| `tests/m3-product-private-metadata-guard.test.mjs` | product #2111 | `9b7c6b1f0782044a28121be201771397a44d7c9d` |
| `tests/qa-m3-private-summary-metadata-identity-red.test.mjs` | QA #2355 copied unchanged from original QA #2096 | `800a4e48e3a1ce777906bfb9fcd842bbde600d6d` |
| `src/domain/observedBasketStudy.ts` | product #2113 | `47b9cd76244f1752db78cffc9ccbc2c4402f333c` |
| `tests/m3-product-week-observation-coherence.test.mjs` | product #2113 | `f27612e5faed2ea138c459cdfdeadcd5746f9eef` |
| `tests/qa-m3-weekstart-observation-coherence-red.test.mjs` | QA #2356 copied unchanged from original QA #2094 | `fa8742c710ba07dc5ef8ac94de246a57b462f9b9` |

Original *on-main* QA tests establish factual pre-fix RED: independent #2096 [CI #38464170331](https://github.com/Zennay/Supa/actions/runs/38464170331) **exact 12 expected RED** (668/680 PASS); independent #2094 [CI #38463496703](https://github.com/Zennay/Supa/actions/runs/38463496703) **exact 4 expected RED** (668/672 PASS). After original owner fixes, isolated independent [#2355](https://github.com/Zennay/Supa/pull/2355) [CI #38517207773](https://github.com/Zennay/Supa/actions/runs/38517207773) **694/694 GREEN** and [#2356](https://github.com/Zennay/Supa/pull/2356) [CI #38517221711](https://github.com/Zennay/Supa/actions/runs/38517221711) **684/684 GREEN** (full high npm audit 0, M1 matching/source permissions, build). This **composed** branch must independently pass its **own exact-head full hosted CI**, not claim an individual-owner result as integrated coverage.

### Acceptance and release boundaries

The assembled M3 behavior independently rejects e-mail-like identifiers in both store and region/population private report metadata, and refuses implausibly old/future shopping evidence for a selected weekly plan. Valid same-demand 11+11 fictional fixture retains private-only observation semantics. CI should be exact HEAD full Node, `npm audit --audit-level=high`, M1 matching and source-permission checks, TypeScript/Vite build.

*The PR is a nonmerge QA integration proof only.* Its product files belong to the existing owners of [#2111](https://github.com/Zennay/Supa/pull/2111) and [#2113](https://github.com/Zennay/Supa/pull/2113). Their PRs are DRAFT with no approved reviews at composition start. **Do not merge this assembly PR or either upstream source PR without verified zCloud SQLite task/scope writer lease, independent owner/reviewer authorization, current exact integrated green CI, applicable trusted permanent VPS/browser evidence, and explicit human releasego.** The future human M3 closure [issue #78](https://github.com/Zennay/Supa/issues/78) still separately requires genuinely observed same-demand PLUS 11 + DekaMarkt 11 within 24 hours, plus source rights. Neither fictional tests nor successful build prove actual price/savings or retailer permissions. M4/M5 ineligible.
