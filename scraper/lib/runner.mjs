import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { HostBlockedError, HttpStatusError, RobotsDisallowedError } from './http.mjs'
import { isValidRecord } from './normalize.mjs'

const MAX_ERROR_RATE = 0.5
const MIN_PAGES_FOR_ERROR_RATE = 40

function isTrustedResponseSource(value, retailerHost) {
  if (typeof value !== 'string' || typeof retailerHost !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === retailerHost.toLowerCase() &&
      !url.username && !url.password && !url.port
  } catch {
    return false
  }
}

// Scrape one retailer into the store. Returns a summary; never throws for
// per-page problems (they are counted), only aborts on a host block or a
// sustained error rate (selector drift / outage => fail closed).
export async function runRetailer(adapter, {
  store,
  fetcher,
  renderer = null,
  limit = Infinity,
  skipFreshHours = 0,
  saveHtmlDir = null,
  log = () => {},
} = {}) {
  store.upsertRetailer(adapter)
  const runId = store.startRun(adapter.id)
  const summary = { retailer: adapter.id, runId, pages: 0, products: 0, skipped: 0, errors: 0, empty: 0, status: 'ok', message: null }

  const fresh = new Set()
  if (skipFreshHours > 0) {
    const since = new Date(Date.now() - skipFreshHours * 3600_000).toISOString()
    for (const row of store.all(
      'SELECT url FROM products WHERE retailer_id = ? AND last_seen_at >= ? AND url IS NOT NULL',
      adapter.id,
      since,
    )) fresh.add(row.url)
  }

  const fetchPage = async (url) => {
    if (adapter.mode === 'browser') {
      if (!renderer) throw new Error(`${adapter.id} needs a browser renderer`)
      return renderer.render(url, { readyCheck: adapter.readyCheck })
    }
    return fetcher.request(url)
  }

  // Host blocks are terminal for this run: completion of another concurrent
  // fetch must not persist HTML or a paid price after the source is blocked.
  let aborted = null
  const handle = async (item) => {
    // Discovery and expansion are untrusted work-item producers. Validate
    // each requested source before *either* HTTP or browser rendering; checking
    // the effective response URL afterwards cannot undo an off-source request.
    if (!isTrustedResponseSource(item?.url, adapter.host)) {
      throw new Error('retailer queued URL is outside approved HTTPS source origin')
    }
    const res = await fetchPage(item.url)
    if (aborted) return []
    summary.pages += 1
    // Foreign or downgraded final response bodies must never be archived
    // under an approved retailer ID, even when the parser would return no rows.
    // The standard HTTP/renderer transports always report the effective URL.
    const sourceApproved = isTrustedResponseSource(item.url, adapter.host) &&
      isTrustedResponseSource(res.url, adapter.host)
    if (saveHtmlDir && !sourceApproved) {
      throw new Error('retailer response origin is not approved for HTML archive')
    }
    if (saveHtmlDir) {
      const dir = join(saveHtmlDir, adapter.id)
      mkdirSync(dir, { recursive: true })
      const name = createHash('sha1').update(item.url).digest('hex').slice(0, 16)
      writeFileSync(join(dir, `${name}.html.gz`), gzipSync(`<!-- ${item.url} -->\n${res.text}`))
    }
    // Source authorization is scoped to the running adapter, never to parser claims.
    // Discard a foreign retailer row before saving it or counting it as ingested.
    const records = adapter.parse(res.text, res.url || item.url)
      .filter((record) => isValidRecord(record) && record.retailer === adapter.id)
    // A synthetic empty-parser budget test may have no approved host, but
    // absolutely no parsed priced rows may be archived without one.
    if (!sourceApproved && records.length) {
      throw new Error('retailer response origin is not approved for price archive')
    }
    if (!records.length) summary.empty += 1
    // Parsing is synchronous; check again before the synchronous transaction
    // and before counting this observation as an accepted product.
    if (aborted) return []
    const at = new Date().toISOString()
    store.transaction(() => {
      for (const record of records) store.saveRecord(record, { runId, at })
    })
    summary.products += records.length
    const more = []
    if (adapter.expand) for await (const next of adapter.expand(res.text, item)) more.push(next)
    return more
  }

  try {
    const queue = []
    const discovered = adapter.discover({ fetcher, log })
    let exhausted = false
    let pulling = Promise.resolve()
    let started = 0

    // Hands out the next work item; generator access is serialised.
    const nextItem = () => {
      // Reserve each request inside this serialized handout, never before an
      // awaited discovery call in separate workers. Fresh skips cost no budget.
      const result = pulling.then(async () => {
        while (!aborted && started < limit) {
          while (!queue.length && !exhausted) {
            const next = await discovered.next()
            if (next.done) exhausted = true
            else queue.push(next.value)
          }
          const item = queue.shift()
          if (!item) return null
          if (item.kind === 'product' && fresh.has(item.url)) {
            summary.skipped += 1
            continue
          }
          started += 1
          return item
        }
        return null
      })
      pulling = result.catch(() => {})
      return result
    }

    const worker = async () => {
      while (!aborted) {
        const item = await nextItem()
        if (!item || aborted) return
        try {
          queue.unshift(...(await handle(item)))
        } catch (error) {
          if (error instanceof HostBlockedError) {
            aborted = error
            return
          }
          if (error instanceof RobotsDisallowedError) {
            summary.skipped += 1
            continue
          }
          if (error instanceof HttpStatusError && (error.status === 404 || error.status === 410)) {
            summary.skipped += 1
            continue
          }
          summary.errors += 1
          log(`[${adapter.id}] error ${item.url}: ${error.message}`)
        }
        const attempts = summary.pages + summary.errors
        if (attempts >= MIN_PAGES_FOR_ERROR_RATE && (summary.errors + summary.empty) / attempts > MAX_ERROR_RATE) {
          aborted = new Error(
            `aborting: ${summary.errors} errors + ${summary.empty} pages without products out of ${attempts} (possible layout drift)`,
          )
          return
        }
        if (summary.pages > 0 && summary.pages % 100 === 0) {
          log(`[${adapter.id}] ${summary.pages} pages, ${summary.products} products, ${summary.errors} errors`)
        }
      }
    }

    await Promise.all(Array.from({ length: Math.max(1, adapter.concurrency ?? 1) }, worker))
    if (aborted) throw aborted
  } catch (error) {
    summary.status = error instanceof HostBlockedError ? 'blocked' : 'failed'
    summary.message = error.message
    log(`[${adapter.id}] ${summary.status}: ${error.message}`)
  }

  store.finishRun(runId, {
    status: summary.status,
    pages: summary.pages,
    products: summary.products,
    errors: summary.errors,
    message: summary.message,
  })
  return summary
}
