# SUPA original Figma source (owner-validated reference)

Source recovered from the graduation design rationale PDF link annotations, pages 22, 24, 29 and 38. Original Figma and its hi-fi screens are the source of truth, not an improvised redesign.

- [SUPA design file](https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA)
- [Hi-fi artboard](https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?node-id=2993-2858)
- [Interactive final prototype](https://www.figma.com/proto/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?page-id=0%3A1&node-id=3289-5329&viewport=-25536%2C5823%2C0.3&t=pD8zQXJxF2ANs8EN-1&scaling=scale-down&content-scaling=fixed&starting-point-node-id=3289%3A5329&show-proto-sidebar=1)

## Visible original design cues (screenshots in design rationale PDF pages 27–29 and 38)

- Airy cool off-white surfaces; white rounded cards; dark forest-green main actions; mint green selection; restrained icon bottom nav.
- Home: personalized greeting, weekplanner, search, photo-driven recipe inspiration, offers section.
- Planner: compact horizontal day selector, food thumbnails, editable day rows, add-meal actions, example budget summary.
- Shopping list: retailer choice chips, categorized checkable product rows, pictures, prices and total.
- Onboarding: benefit-led intro and contextual first-use walkthrough.

## Engineering boundaries

- Read original authenticated Figma nodes/assets/components through an active Figma connection before making fidelity claims or overwriting production UI.
- Keep the existing planner/basket/list state and storage-integrity contracts intact.
- Do not render fictional prices, discounts or savings as real supermarket claims.
- Work in a separate UI lane; do not overwrite active Supa data/product-core branches.
- Test mobile and desktop with exact revision browser checks before replacing the live demo.
