# SUPA UI design source

The user's original SUPA hi-fi is the source of truth for visual UI work:
https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?node-id=2993-2858

- Home: `3307:4224`; Planner: `3359:4896`; Recipes: `3342:5608`; Products: `3064:3125`; Shopping list: `3342:4815`.
- Read actual Figma design context and a screenshot of the screen before changing its visual implementation. Do not invent another visual direction.
- Use project-native React/TypeScript and CSS; preserve domain calculations and storage guards.
- Original Home assets live in `src/assets/figma/home`. Preserve their slot, crop and intrinsic SVG dimensions. Temporary Figma download URLs must never become runtime URLs.
- Figma example products, recipes, prices, discounts, profile and dates are demo content. Do not present them as current prices, measured savings or an authenticated account. In particular, do not ship the unproven “save up to 40%” claim.
- The home, recipe discovery and product discovery surfaces currently share the Home design components. Existing Planner, basket comparison and measurement forms retain their working controls. They still need individual screen-by-screen Figma adaptation; do not claim the entire app has reached visual parity.
