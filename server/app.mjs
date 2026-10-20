import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchRecipeHtml } from './recipe-fetch.mjs'
import { createFileSyncStore, validDeviceKey } from './sync-store.mjs'
import { MAX_SNAPSHOT_BYTES, validateSyncEntries } from './sync-validation.mjs'

/**
 * The API only ever serves an app-valid snapshot: the empty device at
 * revision 0, or a complete record that passes the same rules as a PUT.
 * The store checks file safety and shape; this is the semantic gate.
 */
function servable(record) {
  if (record.revision === 0) return Object.keys(record.entries).length === 0
  return !validateSyncEntries(record.entries, { complete: true }).error
}
import { importRecipeFromHtml } from '../src/domain/userRecipeImport.ts'

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' }

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function rateLimiter(limit) {
  const clients = new Map()
  return key => {
    const now = Date.now()
    for (const [ip, quota] of clients) if (now - quota.start >= 60_000) clients.delete(ip)
    const quota = clients.get(key) ?? { start: now, count: 0 }
    if (quota.count >= limit || clients.size > 1000) return false
    quota.count++; clients.set(key, quota)
    return true
  }
}

/**
 * Collect raw bytes under a byte budget, then decode once with a strict UTF-8
 * decoder: a code point split across TCP chunks stays intact, and malformed
 * bytes are refused instead of becoming U+FFFD in stored records.
 */
async function readBody(req, limit) {
  req.setTimeout(10_000, () => req.destroy())
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, 'Het verzoek is te groot.')
    chunks.push(chunk)
  }
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)) }
  catch { throw new HttpError(400, 'Ongeldige tekencodering.') }
  try { return JSON.parse(text) } catch { throw new HttpError(400, 'Ongeldige JSON.') }
}

export function createRecipeServer({
  root = resolve('dist'),
  fetchHtml = fetchRecipeHtml,
  origin = process.env.APP_ORIGIN,
  syncStore = createFileSyncStore({ dir: resolve(process.env.SUPA_DATA_DIR || '.data/sync') }),
} = {}) {
  let activeImports = 0
  const importQuota = rateLimiter(10)
  const syncQuota = rateLimiter(120)

  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    const json = (status, value, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value))
    }
    const sameOrigin = () => req.headers.origin === (origin ?? `http://${req.headers.host}`) &&
      /^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')
    const pathname = new URL(req.url, 'http://localhost').pathname

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Gebruik GET.' }, { Allow: 'GET, HEAD' })
      return json(200, { status: 'ok', features: { recipeImport: true, sync: Boolean(syncStore) } })
    }

    if (pathname === '/api/recipes/import') {
      if (req.method !== 'POST') return json(405, { error: 'Gebruik POST.' }, { Allow: 'POST' })
      if (!sameOrigin()) return json(403, { error: 'Open de import vanuit Supa.' })
      if (activeImports >= 4 || !importQuota(req.socket.remoteAddress)) return json(429, { error: 'Even wachten: probeer de import over een minuut opnieuw.' })
      activeImports++
      try {
        const { url } = await readBody(req, 4096)
        const { html, sourceUrl } = await fetchHtml(url)
        return json(200, { draft: importRecipeFromHtml(html, sourceUrl) })
      } catch (error) {
        if (error instanceof HttpError && error.status === 413) return json(413, { error: 'De receptlink is te lang.' })
        return json(422, { error: error instanceof Error && !(error instanceof HttpError) && !/ENOTFOUND|ECONN|socket|certificate|JSON/i.test(error.message) ? error.message : 'Het recept kon niet worden opgehaald. Controleer de link of voer het handmatig in.' })
      } finally { activeImports-- }
    }

    if (pathname === '/api/sync') {
      if (!syncStore) return json(503, { error: 'Synchroniseren is op deze server niet beschikbaar.' })
      if (req.method !== 'GET' && req.method !== 'PUT') return json(405, { error: 'Gebruik GET of PUT.' }, { Allow: 'GET, PUT' })
      const deviceKey = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
      if (!validDeviceKey(deviceKey)) return json(401, { error: 'Onbekend apparaat.' })
      if (req.method === 'PUT' && !sameOrigin()) return json(403, { error: 'Open Supa om je gegevens te bewaren.' })
      if (!syncQuota(req.socket.remoteAddress)) return json(429, { error: 'Even wachten met synchroniseren.' })
      try {
        if (req.method === 'GET') {
          const record = await syncStore.read(deviceKey)
          if (!servable(record)) throw new Error('stored sync record is not servable')
          return json(200, record)
        }
        const body = await readBody(req, MAX_SNAPSHOT_BYTES + 4096)
        if (!Number.isSafeInteger(body?.baseRevision) || body.baseRevision < 0) return json(400, { error: 'Ongeldige revisie.' })
        const checked = validateSyncEntries(body.entries)
        if (checked.error) return json(422, { error: checked.error })
        const result = await syncStore.write(deviceKey, body.baseRevision, checked.entries)
        if (result.conflict) {
          if (!servable(result.record)) throw new Error('stored sync record is not servable')
          return json(409, result.record)
        }
        return json(200, { revision: result.record.revision, updatedAt: result.record.updatedAt })
      } catch (error) {
        if (error instanceof HttpError) return json(error.status, { error: error.message })
        return json(500, { error: 'Je gegevens konden niet worden bewaard.' })
      }
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) return json(404, { error: 'Onbekende API-route.' })
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Niet toegestaan.' })
    try {
      const path = resolve(root, '.' + decodeURIComponent(pathname))
      if (path !== root && !path.startsWith(root + sep)) return json(404, { error: 'Niet gevonden.' })
      let file = path; let data
      try { data = await readFile(file) } catch {
        if (extname(path)) return json(404, { error: 'Niet gevonden.' })
        file = resolve(root, 'index.html'); data = await readFile(file)
      }
      // Vite fingerprints everything under /assets; the HTML shell must revalidate.
      const immutable = file.startsWith(resolve(root, 'assets') + sep)
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { json(404, { error: 'Bouw de app eerst met npm run build.' }) }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRecipeServer().listen(Number(process.env.PORT || 4174), process.env.HOST || '127.0.0.1', () => console.log('Supa web + API ready'))
}
