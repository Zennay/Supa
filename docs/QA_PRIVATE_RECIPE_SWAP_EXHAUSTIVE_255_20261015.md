# Independent QA of active product PR #2997 — approved recipe swaps

## Ownership and review boundary
- This is **quality-validation 2/2**, never a product-core code change.
- Frozen product-owner HEAD: `6fb758813730d63a8a5a41a51c6d02a3f352d865` (product PR #2997).
- Add-only test: `tests/qa-private-recipe-swap-exhaustive-255-cases-20261015.test.mjs`.
- QA PR targets the product-owner branch for test evidence only. If the owner branch advances, recompose on its new immutable SHA and rerun CI without weakening the original assertions; do not push to the owner's branch.
- Do not merge QA independently of product owner review, valid zCloud SQLite scope lease, exact-head CI and applicable trusted VPS path gate.

## Independent test coverage
The current M2 fixture defines four active planned days and exactly three approved local recipes. Every nonempty subset and every per-day recipe assignment yields `(1 + 3)^4 - 1 = 255` deterministic offline test cases. For each:
- reverse argument ordering and assert the same canonical chronological selection;
- independently sum the frozen M2 recipe ingredient quantities and units;
- apply the *actual* six-source historical reviewed PLUS/Deka catalog to the actual dynamic plan builder;
- assert one review row per ingredient per store, exact physical quantity/unit, no public pricing/savings/production permission, no unexpected mutation of the global M2 plan.

Three concrete recipe assignments also execute the **actual in-memory CLI and temporary SQLite/Python review pipeline** and compare independent safe aggregate results, historical snapshot counts, absence of live prices/public claims and zero retailer network requests.

No real customer, invoice, current source price, live retailer HTTP, API keys, licensed data, or release permission is introduced. Genuine M3 evidence #78, retailer source rights #74, code pin #205 and permanent selfhosted gate #2833 remain separate HOLD. Even a fully GREEN QA PR does not greenlight M4/M5 or public financial messaging.
