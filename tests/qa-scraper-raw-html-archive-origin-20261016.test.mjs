import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { runRetailer } from '../scraper/lib/runner.mjs'
import { makeRecord } from '../scraper/lib/normalize.mjs'

// Independent synthetic-only QA of optional saved raw HTML. The persistence
// side channel must obey the same post-redirect source-host restriction as
// the priced SQLite archive. Otherwise a foreign response gets mislabeled as
// authorized retailer evidence before the pricing row is discarded.
//
// No network: the final response URL is an injected stub. The evidence path
// lives in a disposable OS temporary directory.
const ADAPTER_HOST = 'source.example.test'
const PAGE = `https://${ADAPTER_HOST}/products/synthetic`

function adapterFixture() {
  return {
    id: 'fictional',
    name: 'Offline fictional retailer',
    host: ADAPTER_HOST,
    status: 'active',
    mode: 'http',
    async *discover() { yield { kind: 'product', url: PAGE } },
    parse() {
      return [makeRecord({
        retailer: 'fictional',
        sourceId: 'fixture-sku',
        url: PAGE,
        name: 'Fictional oats 500 g',
        priceCents: 199,
        packText: '500 g',
      })]
    },
  }
}

async function capture(responseUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'supa-qa-raw-origin-'))
  const saved = []
  const store = {
    upsertRetailer() {},
    startRun() { return 55 },
    transaction(fn) { fn() },
    saveRecord(row) { saved.push(row) },
    finishRun(_id, r) { this.final = r },
  }
  const fetcher = {
    async request() {
      return { url: responseUrl, text: '<article>synthetic raw HTML with no personal data</article>' }
    },
  }
  try {
    const result = await runRetailer(adapterFixture(), {
      store, fetcher, limit: 1, saveHtmlDir: dir,
    })
    const rawFolder = join(dir, 'fictional')
    let names = []
    try { names = readdirSync(rawFolder) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const html = names.length ? gunzipSync(readFileSync(join(rawFolder, names[0]))).toString('utf8') : null
    return { names, html, saved, result }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('approved HTTPS same-host response is preserved as private offline archive evidence', async () => {
  const { names, html, saved, result } = await capture(PAGE)
  assert.equal(result.status, 'ok')
  assert.equal(result.products, 1)
  assert.equal(saved.length, 1)
  assert.equal(names.length, 1)
  assert.match(html, /synthetic raw HTML/)
})

for (const [label, responseUrl] of [
  ['foreign host redirect', 'https://foreign.example.test/products/synthetic'],
  ['host suffix spoof', 'https://source.example.test.attacker.invalid/products/synthetic'],
  ['HTTP downgrade', 'http://source.example.test/products/synthetic'],
  ['userinfo authority spoof', 'https://source.example.test@foreign.example.test/products/synthetic'],
]) {
  test(`no raw archived HTML from ${label} after source provenance refusal`, async () => {
    const { names, saved, result } = await capture(responseUrl)
    assert.equal(result.products, 0)
    assert.deepEqual(saved, [], 'no foreign source may mint a priced fact')
    assert.deepEqual(names, [], 'failed source provenance must not leave misattributed raw HTML evidence')
  })
}
