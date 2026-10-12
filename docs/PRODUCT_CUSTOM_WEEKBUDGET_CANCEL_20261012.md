# Product-core W1 — custom weekbudget cancel and accessible error association

Status: **DRAFT / HOLD / NO MERGE / NO DEPLOY.** This candidate is a review-only child of frozen preset/reset owner [#1867](https://github.com/Zennay/Supa/pull/1867) exact `71ffaab7e24d6064b2c351c4a3ac8cfbc9d82508`, itself downstream of the original PlannerView owner #423 and custom-budget #1856/#1424. It does **not** update original owner branches or `main`.

## User-visible behavior

Once the student opens **Ander bedrag instellen**, they can tap **Annuleren** without having to choose a preset or save a new amount. It is a normal `type="button"` `budget-chip` (minimum 44px height from existing styles), not an implicit form submit. Cancel discards only the unsaved editor text/error and closes the form. The selected budget, basket math, active days, recipes and persisted planner preferences remain unchanged. Reopening a previously saved custom budget still shows that exact value in Dutch notation.

An invalid explicit **Budget opslaan** retains the draft and shows a `role="alert"` paragraph with stable id `custom-weekbudget-error`. The corresponding input remains `aria-invalid="true"` and `aria-describedby` references both the permanent hint and the actual error ID. Editing clears the stale field-error association; valid submit remains the only action that commits an edited custom amount.

## Reproducible product acceptance

- `tests/product-custom-weekbudget-cancel-error-a11y.test.mjs`: **five** synthetic stateful tests invoking the actual TypeScript-compiled PlannerView handlers. Cases: never commit on cancel, exact error→input association, invalid→cancel→reopen, saved custom re-edit cancellation and explicit submit preservation.
- `tests/product-custom-weekbudget-cancel-error-ssr.test.mjs`: **three** independent compiled React server-markup checks for expanded valid editor, expanded invalid/error editor, and closed editor with no stale sensitive draft/error.

Run the exact child branch with standard repository workflow:

```sh
npm ci
node --test tests/product-custom-weekbudget-cancel-error-a11y.test.mjs tests/product-custom-weekbudget-cancel-error-ssr.test.mjs
npm test
npm run build
```

Tests use only deterministic local basket fixture €19,69; there is no real product, retailer, participant, live cart or savings evidence. React SSR/hook simulation is **not** an actual Firefox, keyboard, screen-reader, touch/mobile or production installation proof.

## Release constraints

Source owner #423 / product #1856/#1867 must review the additional button/error markup, verify no collisions with staged product/QA branches, and accept a safe current-main replay after an independent zCloud coordination preflight/claim/lease. Exact-head hosted CI, permanent Firefox/VPS/mobile accessibility and explicit release authorization are required; no direct child-branch merge into main. M3 genuine same-demand PLUS baseline + DekaMarkt candidate observation [#78](https://github.com/Zennay/Supa/issues/78) is still open and cannot be replaced with these UI tests.
