# SUPA product-core — printable physical shopping list (isolated review candidate)

## Scope and phase
M3 is **ACTIVE**. The only M3 exit evidence remains the real same-demand PLUS baseline + DekaMarkt candidate 11+11 human observation pair tracked in [#78](https://github.com/Zennay/Supa/issues/78). This opt-in consumer convenience component is **not** part of M3 evidence, does not fetch retailer prices, and does not authorize M4 or public savings.

## Included in this isolated branch
- Pure `preparePrintableShoppingChecklist(basket)` transforms the **existing** one-store basket into stable price-free physical rows. The canonical data model is not modified.
- React `PrintableShoppingChecklist` offers a 44px minimum print button, paper-only checklist and native browser print. It does not write to storage or transmit data.
- Dutch `piece` names come from the existing shared quantity helper. Unresolved/invalid quantities remain `handmatig kiezen`; no guessed product, price, offer, total or savings enters the paper projection.
- Unique visible line identities are required. The existing controlled `m2-one-store` input is visibly marked as example data.
- Synthetic executable product tests cover deterministic M2 rows, product uncertainty, zero/invalid quantity abstention, physical multipacks, unknown week, duplicate/invisible identities and original basket immutability.

## Owner-controlled integration
The routed `ShoppingListView.tsx`, `App.tsx`, `PlannerView.tsx`, existing owner branches, evidence and workflow files are deliberately **not changed**. After owner review and coordinated lease, the shopping-list owner can compose the opt-in view inside the existing shopping screen, next to the current interactive checklist:

```tsx
import { PrintableShoppingChecklist } from './PrintableShoppingChecklist.tsx'

// Within ShoppingListView, after the existing interactive list:
<PrintableShoppingChecklist basket={basket} />
```

Do not replace the existing interactive checkbox/persistence implementation with the paper view. Browser `window.print()` prints the current document, scoped CSS hides the existing shopping list navigation/cards and shows the dedicated paper rows. Requires **real rendered Firefox** on narrow and desktop screens, print preview to paper/PDF, keyboard-only activation, empty list, unresolved lines, long Dutch labels and explicit demo/trust text. It is not currently routed, so CI/SSR cannot count as end-user acceptance.

## Verification and release posture
- Local script: `node --experimental-strip-types --test tests/product-printable-shopping-checklist.test.mjs`
- Hosted full workflow: `npm test && npm run build`; compare exact final PR head with current main.
- Obtain independent zCloud preflight/write claim/lease, component owner sign-off and applicable permanent VPS/Firefox product gates before integration.
- **DRAFT / HOLD / NO MERGE / NO DEPLOY** without explicit release authorization. Genuine M3 #78 remains OPEN. All data in tests are controlled, not observed retailer evidence.

## Dedicated rendered Firefox proof (isolated from App owner)
A fixture-only page `tests/fixtures/print-preview.html` renders the real React
component with the deterministic M2 basket, including deliberately unresolved
lines. It is served only when explicitly running Vite for local testing; it
does **not** wire the component into the product's routed shopping list.

The separate, read-only `M2 print-preview Firefox proof` workflow at
`.github/workflows/supa-print-preview.yml` starts headless Firefox and
geckodriver on the permanent VPS, exercises a genuine React button click,
measures 430px/800px viewport overflow and 44px touch sizing, and requests a
native W3C WebDriver PDF print. Poppler's `pdftotext` confirms the paper
contains real physical rows and excludes navigation, screen-only cards,
money claims and fabricated savings. The workflow uploads a PDF, screenshots
and a provenance/acceptance JSON under `artifacts/print-browser-e2e`.
The workflow is **synthetic-only** and accepts no retailer or participant input.

To reproduce on a local workstation with Firefox, geckodriver and Poppler:

```bash
npm ci
npm run dev -- --host 127.0.0.1 --port 4189 --strictPort
# In another terminal: geckodriver --port 4455
PRINT_BASE_URL=http://127.0.0.1:4189/tests/fixtures/print-preview.html \
PRINT_WEBDRIVER_URL=http://127.0.0.1:4455 \
  node tests/m2-print-preview-browser.mjs
```

Passing this independent proof is a **browser validation of the standalone
fixture**, not evidence that the production user-facing route is integrated.
Owner composition, latest-main review, private-beta and real retailer proof
remain separately gated.
