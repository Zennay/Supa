# Frontend ↔ backend contract

The frontend does not know about scrapers. It only talks to one JSON API.
Scrapers can change as long as the API keeps returning this shape.

## Switching it on

Set `VITE_API_URL` (see `.env.example`) at build time. Empty = built-in demo
products. If the API is unreachable, slow (8 s) or returns no valid products, the
demo products stay, so no screen is ever empty.

## `GET {VITE_API_URL}/v1/products`

```json
{ "products": [
  { "id": "dirk:12345", "name": "Coca Cola Regular 1,5 liter fles", "store": "dirk",
    "unit": "1.5L", "unitPrice": "€1.16/L", "priceCents": 175, "oldPriceCents": 215,
    "imageUrl": "https://…", "observedAt": "2026-10-30T09:00:00Z" } ] }
```

| field | rules |
| --- | --- |
| `id` | unique, `[A-Za-z0-9_:.-]`, max 80 |
| `store` | `jumbo` `dirk` `ah` `lidl` `plus` `vomar` `aldi` `hoogvliet` |
| `priceCents` | integer euro cents ≥ 0 |
| `oldPriceCents` | optional, only used when higher than `priceCents` |
| `imageUrl` | optional, `https://` only |
| `observedAt` | ISO 8601; when the price was seen |

Invalid items are dropped (`src/services/productApi.ts`), never repaired.
CORS: the API must allow the site origin (`https://zennay.github.io`).

## Planned next (not built yet)

- `GET /v1/products?store=&q=` for search and per-store filtering on the server.
- `POST /v1/basket` with the planned ingredients → matched products per selected
  supermarket, so the shopping list shows real prices and the "Totaal" is real.
- Price age: show `observedAt` in the list so stale prices are visible.

## Testing the connection locally

```bash
node scripts/mock-product-api.mjs
VITE_API_URL=http://127.0.0.1:4180 npm run dev
```

## Rights

Production use of scraped retailer data stays gated by the project's permission
checks (see `README.md`). Do not point the public site at scraper output before
that is cleared.
