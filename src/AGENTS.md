# Visual source of truth

For SUPA UI work, use the user's original Figma high-fidelity design:
https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?node-id=2993-2858

Fetch the requested screen with Figma design context and a screenshot before implementing visual changes. Reuse original exported assets and project React/CSS conventions. Do not replace this design with a new generic dashboard or a different visual direction.

Screen map and current implementation: `docs/SUPA_HIFI_IMPLEMENTATION.md`. Home assets: `src/assets/figma/home/`. Preserve the working planner, basket, list and guarded storage behaviors when adapting other screens. Never turn design-only prices, savings, identities or offers into claims of current data.
