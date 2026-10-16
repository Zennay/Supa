# Original SUPA hi-fi in the application

Source: https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?node-id=2993-2858

Implemented from the actual high-fidelity MCP design context and screenshot for Home `3307:4224`, retrieved 2026-10-16. This is a React/CSS implementation, not an embedded screenshot.

## Delivered
- Default Home screen with mint planning card, search, recipe carousel, two-column product cards and five-item floating navigation.
- All 26 original image/SVG exports downloaded into the repository. The original product-photo sizes and supermarket logo crops are retained. SVGs render at intrinsic dimensions.
- Working query filtering, favorite filtering, recipe preview dialog, product selection/removal and a clearly labelled demo product list. Existing planner, preference persistence, basket comparison, shopping checklist and measurement view remain connected.
- Styling follows the source palette, SF Pro/system font stack, spacing, radii and asset placement. Responsive adaptations preserve mobile usability.

## Deliberate content differences
Figma's fixed identity is labelled demo. Its unverified “up to 40%” claim is replaced with non-quantified copy. Design product prices are explicitly non-current examples and never enter the comparison engine. The banana's erroneous `1.5L` quantity is replaced with `Per verpakking`. Recipe cards have preview dialogs but no invented ingredients or preparation instructions.

## Remaining screens
Planner `3359:4896`, Recipes `3342:5608`, Products `3064:3125` and Shoplist `3342:4815` need individual high-fidelity context extraction and full visual adaptation. The current recipe/product discovery tabs reuse the exact Home cards. Existing working domain screens inherit the palette, not full screen parity.

## Validation
The M2 Firefox workflow enters Planner from the new Home before replaying all existing planner/basket/list and storage checks. The dedicated hi-fi browser check verifies navigation, search, favorite filtering, modal dismissal, demo selection/removal, local asset loading and narrow-screen overflow. No scraper or price-source gates are modified.


## Planner follow-up (2026-10-16, stacked on Home PR #3379)

- Added a real, interactive Figma-derived **Weekplanning** card from original node `3359:4900`, with the source's white 20px/24px surface, SF Pro sizing, mint activity indicator and circular day controls.
- **Not a claim of full Planner parity:** the Figma card's fixed example dates and its decorative recipe photography are deliberately not copied into the real planner; the card instead shows the browser's local week dates and existing domain days. Exact image-led states in this frame still require reviewed local image assets and visual comparison.
- Day selection uses exactly the existing `activeDays` + `onToggleDay` state, so the existing guarded persistence, basket calculations, budget, recipe swap controls and shopping list continue to use one source of truth.
- Added native Vite SSR regression testing for Figma source marker, active/inactive labels, selected count, no invented prices/claims and existing Planner budget/recipe-list wiring.
- Home's original five Sunday→Thursday calendar chips now derive the upcoming real local dates, carry selected-day markers from persisted planner preferences, and navigate back to Planner. Regression coverage includes Sunday, upcoming Sunday, Dutch weekday labels, DST and year rollover; no frozen prototype 19–23 strip in production.
- Branch `feat/supa-figma-planner-week-card-20261016` deliberately targets UI owner `feat/supa-original-figma-hifi-home-20261016`, not `main`; no scraper, reviewer QA, price evidence, rights or deploy mutation.
- Remaining: verified hosted build/tests on exact new head; mobile Firefox visual screenshot; full Figma Planner/Recipes/Products/Shoplist parity and asset reconciliation. Do not merge stacked work before the parent UI branch is resolved.
