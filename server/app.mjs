import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fetchRecipeHtml } from './recipe-fetch.mjs'
import { importRecipeFromHtml } from '../src/domain/userRecipeImport.ts'

// These public .mjs modules are imported by the real CSV/JSON workflow.
// Combined with nosniff, application/octet-stream prevents their execution.
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}
export function createRecipeServer({ root = resolve('dist'), fetchHtml = fetchRecipeHtml, origin = process.env.APP_ORIGIN } = {}) {
  let active = 0
  const clients = new Map()
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)) }
    if (req.url === '/api/recipes/import') {
      if (req.method !== 'POST') return json(405, { error: 'Gebruik POST.' })
      const expectedOrigin = origin ?? `http://${req.headers.host}`
      if (req.headers.origin !== expectedOrigin || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return json(403, { error: 'Open de import vanuit Supa.' })
      const key = req.socket.remoteAddress; const now = Date.now()
      for (const [ip, quota] of clients) if (now - quota.start >= 60_000) clients.delete(ip)
      const quota = clients.get(key) ?? { start: now, count: 0 }
      if (quota.count >= 10 || active >= 4 || clients.size > 1000) return json(429, { error: 'Even wachten: probeer de import over een minuut opnieuw.' })
      quota.count++; clients.set(key, quota); active++
      try {
        req.setTimeout(10_000, () => req.destroy())
        const declaredLength = req.headers['content-length']
        if (declaredLength !== undefined) {
          const bytes = Number(declaredLength)
          if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 4096)
            return json(413, { error: 'De receptlink is te lang.' })
        }
        let body = ''
        for await (const chunk of req) {
          body += chunk
          // String.length counts UTF-16 code units, not UTF-8 request bytes.
          // Keep chunked requests under the same byte ceiling as declared ones.
          if (Buffer.byteLength(body, 'utf8') > 4096)
            return json(413, { error: 'De receptlink is te lang.' })
        }
        const payload = JSON.parse(body)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            typeof payload.url !== 'string' || payload.url.length > 2048)
          return json(422, { error: 'Geef één geldige openbare receptlink op.' })
        const { html, sourceUrl } = await fetchHtml(payload.url)
        return json(200, { draft: importRecipeFromHtml(html, sourceUrl) })
      } catch (error) { return json(422, { error: error instanceof Error && !/ENOTFOUND|ECONN|socket|certificate|JSON/i.test(error.message) ? error.message : 'Het recept kon niet worden opgehaald. Controleer de link of voer het handmatig in.' }) }
      finally { active-- }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Niet toegestaan.' })
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const path = resolve(root, '.' + pathname)
      if (path !== root && !path.startsWith(root + sep)) return json(404, { error: 'Niet gevonden.' })
      // The bundled Node entrypoint lives next to site assets so deployments
      // can ship one artifact. It is executable server code, not a public asset.
      if (path === resolve(root, 'server.mjs')) return json(404, { error: 'Niet gevonden.' })
      let file = path; let data
      try { data = await readFile(file) } catch {
        if (extname(path)) return json(404, { error: 'Niet gevonden.' })
        file = resolve(root, 'index.html'); data = await readFile(file)
      }
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch { json(404, { error: 'Bouw de app eerst met npm run build.' }) }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createRecipeServer().listen(Number(process.env.PORT || 4174), process.env.HOST || '127.0.0.1', () => console.log('Supa web + recipe import ready'))
}
