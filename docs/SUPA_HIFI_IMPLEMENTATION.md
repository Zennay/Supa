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
- Multi-term search treats each word as a separate constraint across metadata and search-normalizes Dutch decimal commas plus number/unit spacing (for example, `1,5 l` and `1.5L`); captured source values remain untouched. Multipack notation is normalized for search too, so `6 × 330 ml`, `6x330ml` and `6 x 330 ml` find the same catalog entry without changing the original pack label. Written metric names are also matched to abbreviations (`liter`/`litre` → `l`, `milliliter` → `ml`, `kilogram` → `kg`, `gram` → `g`) so equivalent search terms find the same result while source labels remain unchanged. Visible result counts announce updates to assistive technology.
- Switching between historical identities and Figma examples preserves the typed search query but clears source-specific filters, so a favorites-only selection from one catalog cannot silently make the other catalog appear empty.
- The product-source selector appears once in the Products flow (not duplicated inside the optional filter panel) and exposes its two mutually exclusive choices as an accessible control group.
- Empty results in recipes, historical products and Figma examples now offer a direct accessible reset action that clears the search and source-specific filters; users do not have to reopen the filter panel to recover the catalog.
- Favorites persist across Home/Producten unmounts in a versioned local record; malformed/future records and cross-tab changes are protected from silent overwrite, and storage denial is surfaced as session-only behavior.
- The favorites view follows valid changes from another browser tab through the storage event; conflicting or future-format records remain protected rather than being replaced.
- Old product IDs from a previous catalog version remain visible as explicitly unrecognized, unpriced list entries with a user-controlled remove action instead of disappearing from the list while still inflating its count.
- Entering Products from another tab clears recipe-only favorites and source-specific filters because recipe and product IDs are separate domains; this prevents an unrelated favorites selection from hiding the entire catalog.
- Planner and the manual Meten/observation screen are route-level lazy chunks with explicit loading announcements, so the initial Home/Producten bundle does not eagerly load those full workflows.
- The personal-source list, unpriced planner checklist and demo shopping list are also split into on-demand chunks with loading announcements, while keeping their existing mount/storage contracts.
- Planner week-recovery controls and the optional share-text editor are also lazy-loaded; the share editor chunk is fetched only when the user requests copy text.
- This is discovery-only behavior: it does not add current retailer prices, change source rights, or feed demo values into the private reviewed-basket calculator.

## Eigen Producten-selectie afvinken in Lijst (22 oktober 2026, bestaande PR #3959)

- Historische bronidentiteiten, Figma-voorbeelden en oude/onbekende persoonlijke IDs hebben nu een aparte ongeprijsde afvinklijst in Lijst: per product aantikken, voortgang, alleen nog open tonen, bevestigde reset en grote mobiele raakvlakken.
- De afvinkstatus heeft eigen begrensde lokale opslag met versienummer en compare-and-set tegen andere-tabwijzigingen. Onbekende schema's worden beschermd in plaats van overschreven; selectie en afvinkstatus blijven separate data.
- Verwijderen van een selectie wist, als opslag dat toestaat, de oude afvinkstatus. Hele persoonlijke selectie en uitsluitend nog te kopen kunnen afzonderlijk als lokale TXT worden bewaard.
- Een knop kopieert uitsluitend nog te kopen op het klembord; bij geweigerde toegang is handmatige tekstselectie mogelijk.
- De status is handmatig bijgehouden: geen kassabon, bronrecht, SKU-match, voorraad, actuele prijs, besparing of gecontroleerde aankoop. Planner, persoonlijk goedgekeurde winkelprijzen en echte winkelafvinkingen blijven onaangeroerd. Geen QA- of regressiesuites geschreven of gedraaid.

## Personal shopping quantities and notes (22 October 2026, existing PR #3959)

- The independently selected, **unpriced** Products → Lijst items now accept an explicitly user-entered whole quantity from 1 to 99 and an optional note up to 120 characters. Counts are user intentions, **not** known pack sizes or retail purchase units.
- Quantity and note stay in a separate versioned, bounded on-device record. Cross-tab updates are adopted; unknown future versions and concurrently changed records are not overwritten. Removing a selected product also clears its personal details where storage permits.
- The mobile Lijst interface includes accessible quantity and note fields for historical source identities, Figma examples, and retained old selection IDs. Full and open-only TXT/clipboard text explicitly includes each user's count and note, while every original price field stays unknown or demo-only.
- Existing observed-store imports, SKU/pack reviews, matching, planner demands, price arithmetic, M3 rights, and source evidence gates remain entirely separate. This feature makes **no** verified retailer price, stock, savings, or purchase claim. No additional QA suites were authored or run.

## Offline overdracht van de hele ongeprijsde boodschappenlijst (22 oktober 2026, PR #3959)

- Naast de bestaande JSON-export van uitsluitend geselecteerde identiteiten is er nu een expliciete persoonlijke shopping-back-up voor bekende Producten-identiteiten met per item het hele door de gebruiker gekozen aantal, eigen notitie en handmatige afvinkstatus.
- Deze afzonderlijke back-up gebruikt een strak schema, maximaal 100 unieke bekende productidentiteiten en 32 KiB UTF-8. Extra velden zoals bron-SKU, supermarktprijs, beschikbaarheid, productmatch, bronrecht of besparingsclaim worden geweigerd; onbekende of toekomstige schema's blijven ongewijzigd.
- Via het Lijst-scherm kan de gebruiker een bestand openen of eigen JSON plakken, vóór toevoegen de echte productnamen/aantallen/notities van uitsluitend ontbrekende artikelen zien, en ze met een aparte knop accepteren. Bestaande selecties, hoeveelheden, notities en vinkjes worden niet stilzwijgend overschreven; bij capaciteitstekort blijft alles behouden.
- Bij opslagconflicten tussen tabs wordt toevoeging afgebroken. Het formulier blijft ook op een apparaat met een lege persoonlijke selectie bereikbaar. De originele metrische Planner, eigen winkelprijs-import, menselijke SKU-/verpakkingsreview en vergelijker blijven los van deze ongeprijsde reislijst.
- VPS-omgeving was zwaar verzadigd (load >90, 8 GiB swap volledig bezet), waardoor een directe push/build op de machine niet betrouwbaar afrondde. De productwijzigingen zijn via de geautoriseerde GitHub-connector op de al bestaande PR-branch aangebracht. Een geslaagde exacte-head build of deploy is niet geclaimd; bestaande verplichte CI/review blijven leidend. Geen QA-suites handmatig gestart.
