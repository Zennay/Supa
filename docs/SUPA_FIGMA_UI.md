# SUPA UI: original Figma source of truth

- Figma file: https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA
- Original high-fidelity node: https://www.figma.com/design/KMGkWG5zc2rVBUV3KSS5Ck/SUPA?node-id=2993-2858
- Application repository: https://github.com/Zennay/Supa

## Design-to-code workflow

1. Use Figma's **official remote MCP** (`https://mcp.figma.com/mcp`), configured in `/.codex/config.toml`. A user must authorize the Figma account through OAuth; repository config alone is not authentication.
2. Open the original high-fidelity frame in Figma and fetch its design context, components, variables, layout, imagery and relevant sibling frames via MCP before replacing any page layout. Never assume these design details without reading the file.
3. Implement the original SUPA look as responsive React/TypeScript UI in the existing app. Prioritize homepage, recipes/inspiration, weekly planner, and shopping list; reuse components and design tokens consistently. Prefer existing flows over rewrites.
4. Keep domain and safety behavior intact: product pricing and retailer permissions must remain evidence-gated. A polished mock must not claim that unavailable prices, savings or live supermarket comparisons are verified.
5. Validate desktop and mobile renders, interactions, accessibility basics, types and build before proposing UI integration.

## Connecting in Codex Desktop

Install the Figma plugin through **Plugins → Figma → Install Figma**, then grant account access. If using Codex CLI instead, the remote MCP config is available in this trusted workspace and `codex mcp login figma` can be used when sign-in is required. Restart/open a fresh Codex session after connection so its available tool list refreshes.

This document records the design target; it is not a claim that Figma access has already been authorized or that the UI has been implemented.
