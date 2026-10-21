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


## Producten + Lijst visual follow-up (2026-10-20, PR #3946)

- Re-read Figma design context for Products node `3064:3125` and Shoplist node `3342:4815`. Initial Producten view now uses the previously exported Figma image/photo assets rather than showing price-free historical monogram cards first. The Poppins 18px header, icon/search sizes, two-column product cards, product ordering, unit-price sorting, filters and planner shortcut follow the Figma composition. Historical source identities remain available under the filter panel.
- Lijst has 16px circle checks, 50px thumbnail slots, label/quantity, conditional line-price column, 20px white cards, source basket totals in a bottom 24px-padding card and a collapsed copy/print area. The real checklist, local storage protections and empty/unresolved states remain intact. Figma demo-product selections are secondary to the actual list.
- Restored **five** Figma floating navigation tabs. Existing Vergelijk and Meten remain reachable from secondary utilities on the live Planner/List screens.
- **Not yet 1:1 visually accepted.** Figma screenshot retrieval hit the connected Starter-tool quota. Original Figma-only photos for Shoplist/Producten, exact assets/crops, visual screenshot diff and remaining full Planner parity are still pending. Avoid claims that these two screens, or the complete app, are pixel-perfect until screenshot comparison and an exact-head production build succeed. UI-only implementation does not represent a current supermarket-price feed or rights-document audit.

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


## Originele Figma-productbeelden en iconen (20 oktober 2026)

- Producten node `3064:3125`: 18 originele, lokaal gebundelde Figma-exports hersteld onder `src/assets/figma/products/` (10 product-PNG's + 8 SVG's); bestaande originele Home-assets hergebruikt waar ze byte-identiek dezelfde bron-export zijn. Geen runtime-links naar tijdelijke Figma-bestanden.
- Nu 13 oorspronkelijke Producten-afbeeldingsslots uit de gelezen Figma-designcontext beschikbaar: Coca-Cola-varianten, rode paprika, watermeloen, melk, sixpack, gebak, muffins, pindakaas, fruitsalade en gember. Fotoweergave `68×72` binnen de `120px` productkaart-fotovlakken. Alle nieuw toegevoegde productkaarten zijn **demo**; ontbrekende Figma-prijzen worden niet verzonnen en staan niet in het echte mandtotaal.
- Oorspronkelijke Producten-icons voor filter, zoekveld, weekknop, sortering en 5-vaks navigatie gebruikt, inclusief ongewijzigde SVG-intrinsieke maten. De Home-productcatalogus is bewust onveranderd.
- Code-build `npm run build -- --base=/supa/` is geslaagd op exacte productiebron-HEAD `34393e9`; er zijn geen QA- of regressiesuites toegevoegd of uitgevoerd.
- **Nog open richting exact 1:1:** individuele Figma-productteksten, ontbrekende voorbeeldprijzen, exacte schermscreenshotvergelijking en specifieke Lijst-productfoto's. Figma MCP Starter limiet blokkeert nu nieuwe screenshots; geen volledige visuele acceptatie claimen tot de bron weer beschikbaar is. De originele lokale afbeeldingen zijn geen bewijs van actuele supermarktprijzen.

## Product discovery search follow-up (2026-10-21)

- Product search uses the existing accent-insensitive normalizer and matches the displayed product name, retailer, package/unit, demo price text and product ID. Historical price-free source identities also match their retailer, package, capture timestamp, source URL and source ID.
- Switching between historical identities and Figma examples clears cross-source filters, so a favorites-only selection from one catalog cannot silently make the other catalog appear empty.
- This is discovery-only behavior: it does not add current retailer prices, change source rights, or feed demo values into the private reviewed-basket calculator.
