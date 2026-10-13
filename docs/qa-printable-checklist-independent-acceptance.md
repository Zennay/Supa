# SUPA QA — isolated printable-list trust and render acceptance

**Phase:** M3 ACTIVE. **Posture:** DRAFT / HOLD / NO MERGE / NO DEPLOY.

This is independent quality-validation stacked on the immutable product owner candidate [PR #2068](https://github.com/Zennay/Supa/pull/2068) at commit `685f7f74ce4b1359593de56c50fbfb1f92b6e32d`. No source files, existing product tests, CI workflows, human retailer observations, branch owners or `main` are modified.

## Concrete independent QA gates

- Run the real M2 `buildOneStoreBasket` to project the canonical physical checklist; retain exact row order, review count, source immutability and a **price-free output schema**.
- Execute mass (g/kg), volume (ml/l) and piece/multipack cases: accepted physical packs must be precisely the minimal whole outer count. Synthetic stale underbuy/overbuy, illegal count, unknown/incompatible unit, zero/NaN/infinite amount, and oversized pack count must explicitly switch to *handmatig kiezen*.
- Remove the controlled chicken item and verify exactly that row becomes unresolved; never invent an alternative or drop it silently.
- Confirm invisible-only store/ingredient labels downgrade to `Winkel nog te kiezen` / `Onbekend ingrediënt` rather than a blank, trusted purchase.
- Server-render the **real React component**, not a mock, with 22 separately identified rows, multiple unresolved items, label escaping, a semantic native print button and visibly gated paper CSS. Ensure output contains no source-level monetary, participant or timestamp fields. This is SSR/CSS review, **not a real Firefox print preview**.

## Next release gates

1. Hosted exact-head `npm test`, high security audit, matching benchmark, source-permission check, TS/Vite build; permanent VPS and applicable Firefox checks as independently verified. Capture exact Git SHA, run/job IDs and true conclusions. Do not count queued jobs as passing.
2. Obtain zCloud ownership/lease/preflight, shopping UI owner's explicit review, current main integration and real **Firefox print-preview** with 320–430px + desktop sizes, keyboard print activation, long wrapping, multipacks, empty list, and unmatched ingredients.
3. The candidate is not routed into `ShoppingListView`: no user-visible end-to-end proof exists until the original integration owner mounts it and checks persistent v1/v2 checklist compatibility.
4. **M3 issue #78** still requires authentic same-demand 11+11 PLUS/DekaMarkt observations within 24h with lawful source permissions and privacy-safe attribution. Synthetic printing does not satisfy this evidence gate. Do not infer real savings or open M4 beta.

Any counterexample on the immutable frozen parent should become a separately described QA finding, not a silent change to its owner branch. Independent work is deliberately add-only and merge/deploy are held for approval.
