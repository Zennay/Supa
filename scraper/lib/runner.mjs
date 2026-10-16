import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { HostBlockedError, HttpStatusError, RobotsDisallowedError } from './http.mjs'
import { isValidRecord } from './normalize.mjs'

const MAX_ERROR_RATE = 0.5
const MIN_PAGES_FOR_ERROR_RATE = 40

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

  if (adapter.minDelayMs && fetcher.setHostDelay) fetcher.setHostDelay(adapter.host, adapter.minDelayMs)

  const fetchPage = async (url) => {
    // Adapters with their own transport (e.g. a JSON API) return { url, text }.
    if (adapter.fetch) return adapter.fetch(url, { fetcher, log })
    if (adapter.mode === 'browser') {
      if (!renderer) throw new Error(`${adapter.id} needs a browser renderer`)
      return renderer.render(url, { readyCheck: adapter.readyCheck })
    }
    return fetcher.request(url)
  }

  const handle = async (item) => {
    const res = await fetchPage(item.url)
    summary.pages += 1
    if (saveHtmlDir) {
      const dir = join(saveHtmlDir, adapter.id)
      mkdirSync(dir, { recursive: true })
      const name = createHash('sha1').update(item.url).digest('hex').slice(0, 16)
      writeFileSync(join(dir, `${name}.html.gz`), gzipSync(`<!-- ${item.url} -->\n${res.text}`))
    }
    const records = adapter.parse(res.text, res.url || item.url).filter(isValidRecord)
    if (!records.length) summary.empty += 1
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
    let aborted = null

    // Hands out the next work item; generator access is serialised.
    const nextItem = () => {
      const result = pulling.then(async () => {
        while (!queue.length && !exhausted) {
          const next = await discovered.next()
          if (next.done) exhausted = true
          else queue.push(next.value)
        }
        return queue.shift() ?? null
      })
      pulling = result.catch(() => {})
      return result
    }

    const worker = async () => {
      while (!aborted && started < limit) {
        const item = await nextItem()
        if (!item) return
        if (item.kind === 'product' && fresh.has(item.url)) {
          summary.skipped += 1
          continue
        }
        started += 1
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
