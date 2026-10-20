# M3 cross-basket snapshot atomicity — owner decision proposal

Status: **PROPOSAL / NOT AN OWNER APPROVAL** (2026-10-11). Tracks [#1508](https://github.com/Zennay/Supa/issues/1508), independent of physical index pinning [#1484](https://github.com/Zennay/Supa/issues/1484). **M3 ACTIVE; DRAFT / HOLD / NO MERGE / NO DEPLOY.**

## Problem / reproducible counterexamples

The financial comparator reads two caller-owned graphs **sequentially**. Even if each basket is independently checked and snapshotted using own-data descriptors, a Proxy `getOwnPropertyDescriptor` callback while reading the *second* basket may modify an already-finished first snapshot's original graph. The output can be internally coherent but was never a coherent simultaneous observation of both baskets.

- Baseline-first staged source: [#1502](https://github.com/Zennay/Supa/pull/1502), [exact-head CI #38124586764](https://github.com/Zennay/Supa/actions/runs/38124586764): three synthetic counterexamples expected RED; unaffected positive case green.
- Naive unconditional first-basket recheck: [#1503](https://github.com/Zennay/Supa/pull/1503), [CI #38124616311](https://github.com/Zennay/Supa/actions/runs/38124616311): 76 existing descriptor-visit count tests failed. Additional passes also cannot constitute an unconditional atomic read if traps can act during those passes.
- Candidate-first one-pass: [#1505](https://github.com/Zennay/Supa/pull/1505) + [#1506](https://github.com/Zennay/Supa/pull/1506), [CI #38124847914](https://github.com/Zennay/Supa/actions/runs/38124847914) green, but **not** an atomicity fix.
- Candidate-first inverse: [#1507](https://github.com/Zennay/Supa/pull/1507), [CI #38124914773](https://github.com/Zennay/Supa/actions/runs/38124914773): three opposite-direction expected RED cases. Baseline-last descriptor callbacks mutate already-snapshotted candidate cents/identity/physical slots.

All demonstrations use **synthetic JavaScript objects and Proxies**. These are not observed retailer conditions, permission checks or savings evidence.

## Decision required from original source/QA owner

**Recommended scope, subject to explicit approval:** Promise accurate money only for a *trusted, owned, complete data snapshot* produced by the approved M2 basket builder or the canonical validated M3 JSON observation converter. A hostile caller-owned live Proxy graph must **not** be represented as a supported atomic financial-claim input. Exported `compareFullBaskets` currently accepts arbitrary runtime objects, so this is **not implemented merely by writing this policy**. Owners must define a verifiable boundary between untrusted and trusted inputs before adopting that contract.

A contract that continues to admit arbitrary descriptor-trapping Proxies must instead specify how a coherent cross-basket read is obtained. **Changing read order, re-reading once or freezing an untrusted object is insufficient** to prove simultaneous atomicity: the latest descriptor callback can mutate a previously observed part, and arbitrary freezing/serialization can itself invoke traps or change caller state. JS does not expose a general reliable `isProxy` check. Do not mistake one successful hosted run for a proof of universal atomicity.

Suggested owner design checkpoints:

1. Identify the actual entry points for observed JSON, the live planner's trusted baskets, and direct exported-comparator callers. Describe what each admits, rejects or labels nonclaimable; never silently widen a public money-claims API.
2. Specify an **owned snapshot / producer provenance** or another sound handoff, rather than a caller-spoofable `trusted: true` flag. Bound arrays and nested data, admit only supported primitive values and complete exact-cent matching; reject malformed/hostile inputs safely without executing ordinary getters.
3. Keep validated immutable plain-data cases working: same/better/worse, exact cent delta and savings, 11-demand physical slots, explicit unknown/partial outcomes, no mutation of input, no participant key in public report and `publicSavingsClaimEligible: false`.
4. If an adversarial Proxy can still enter the trusted claims path, **both** directional tests must fail closed (`outcome='unknown'`, `claimable=false`, `deltaCents=null`, `savingsCents=null`, `lineDeltas=[]`), without executing an ordinary GET. Tests should include cents with reconciled root totals, product provenance, pack/requirement drift and physical-slot order; repeat with baseline-first and candidate-first and stable no-op positives.
5. Verify worst-case resource bounds (10,000 physical rows admitted, 10,001 refused before indexed reads), call count/performance contract, fail-closed exceptions and independently fresh DTOs. Measure on the **exact head**, not a previously green ancestor.

## Integration / evidence policy

- **No direct merge** of the experimental #1502–#1507 branches. They are diagnostic source/test candidates, not approved atomicity repairs.
- Require original comparator/QA owner decision, zCloud write lease and scope coordination, minimal clean replay against then-current `main`, full hosted checks, applicable permanent VPS/mobile/Firefox/M3 jobs and code review. The very large inherited stacked PR histories must not be integrated wholesale.
- Real M3 exit remains human issue [#78](https://github.com/Zennay/Supa/issues/78): one genuinely observed same-11-demand PLUS baseline and DekaMarkt candidate within 24 hours in one price context, run through canonical converter/assessor and preserve **better, same, worse or unknown** outcomes. Generate one current-main field pack **only when real human collection begins**. No synthetic result or QA PR authorizes real savings claims.

### Current unambiguous disposition

The two directional RED demonstrations prove that neither read order is sufficient. **This proposal does not claim a fixed comparator, tested runtime admission boundary or closed M3 gate.** The original owner must choose the supported-input contract and its implementation before issue #1508 can close.
