# SUPA backend API

`server/app.mjs` serves the built app (`dist/`) and a small JSON API on one origin (default `http://127.0.0.1:4174`, `PORT`/`HOST` to change). The browser keeps working from `localStorage` when the API is absent (static hosting, offline). The API adds a server copy of the user's data and the recipe link import.

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | `{ status: "ok", features: { recipeImport, sync } }` |
| `/api/recipes/import` | POST | `{ url }` → `{ draft }` from a public HTTPS recipe page (SSRF-guarded, same-origin only, 10/min per IP) |
| `/api/sync` | GET | This device's saved records `{ revision, updatedAt, entries }` |
| `/api/sync` | PUT | `{ baseRevision, entries }` → `200 { revision }`, `409` with the newer server copy, `422` when a record fails validation |

Any other `/api/*` path returns a JSON 404, not the HTML shell. Hashed files under `/assets/` are served `immutable`; `index.html` is `no-cache`.

## Device sync

- The browser creates a random 256-bit device key (`supa:device-key:v1`) and sends it as `Authorization: Bearer …`. There are no accounts yet: whoever holds the key can read that device's records, so treat it like a password. On disk the server stores one file per **hash** of the key in `SUPA_DATA_DIR` (default `.data/sync`, git-ignored), written atomically.
- Synced records are only: `supa:planner-preferences:v2`, `supa.recipe-library.v1`, `supa:shopping-list-progress:v1`. M3 observation drafts never leave the device.
- The server validates every record with the same rules the app uses before trusting it (`server/sync-validation.mjs`): planner envelope, day names and recipe ids (including own recipes in the same snapshot), the recipe library, and the shopping-progress shape. Snapshots are limited to 2.5 MB.
- Writes need the page's own `Origin` and JSON content type. `baseRevision` gives optimistic concurrency, so two tabs or devices cannot silently overwrite each other.
- That compare-and-swap is global for every server process sharing `SUPA_DATA_DIR` on one filesystem. Each write takes an exclusive per-device lock file (`O_EXCL`), re-reads the revision under it, and publishes through a uniquely named `O_EXCL` temp file plus an atomic rename. The losing writer gets `409` with the stored record. A lock left by a crashed writer is removed after 15 s. Network filesystems without reliable `O_EXCL` are not supported.
- Request bodies are read as bytes under a byte budget and decoded once with a strict UTF-8 decoder. Characters split across TCP chunks survive intact, and malformed UTF-8 is refused (`400` on sync, `422` on import) without storing anything.

Browser side (`src/lib/supaSync.ts`, started from `src/main.tsx`):

1. Before the first render (max 1.5 s) it pulls the server copy and adopts each record this browser has not changed since its last sync. Local edits are never overwritten, and an older or wiped server copy never deletes local data; it is uploaded again instead.
2. While the app is open it pushes changes every 4 s and when the tab is hidden. On `409` it merges once (server value for untouched records, local value for edited ones) and retries. It stops on `422`, or when the host has no API.

## Development

```bash
npm run dev:full   # API on 4174 + Vite on 5173 (Vite proxies /api, keeping the Host header for the origin check)
npm run dev:api    # API only
```

Tests: `tests/server-sync-api.test.mjs`, `tests/frontend-sync-client.test.mjs`, `tests/recipe-import-server.test.mjs`. `tests/sync-browser.mjs` runs in the Recipe UI preview workflow: it adds a recipe and plans it in one browser, then restores both in a second browser profile through the real server.
