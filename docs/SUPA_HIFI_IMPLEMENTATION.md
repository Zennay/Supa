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
