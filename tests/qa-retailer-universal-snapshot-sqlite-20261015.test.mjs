import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const command = new URL('../scripts/retailer-import-universal-sqlite.py', import.meta.url).pathname
const retailers = ['plus', 'dekamarkt']
const kinds = ['product', 'catalog', 'offers']
function batch() {
  const results = []
  for (const retailer of retailers) for (const kind of kinds) {
    const identity = kind === 'offers' ? 'promo_' + retailer : 'sku_' + retailer
    const host = retailer === 'plus' ? 'www.plus.nl' : 'www.dekamarkt.nl'
    const observation = {
      supermarket: retailer,
      sourceProductId: identity,
      name: kind === 'offers' ? 'Synthetic Promo' : 'Synthetic Melk',
      currentPriceCents: kind === 'offers' ? 89 : 185,
      currency: 'EUR',
      pack: { rawText: '1 liter', amount: 1, unit: 'l' },
      offer: kind === 'offers' ? {
        label: 'fictional discount', mechanics: null,
        offerPriceCents: 89, originalPriceCents: 199,
        validFrom: '2026-10-01T00:00:00Z', validTo: '2026-10-05T00:00:00Z',
      } : null,
      availability: 'unknown',
      provenance: {
        supermarket: retailer, kind,
        url: 'https://' + host + '/' + kind,
        capturedAt: '2026-10-04T12:00:00.000Z',
        sha256: (kind.charCodeAt(0).toString(16) + retailer.charCodeAt(0).toString(16)).padEnd(64, '0'),
      },
    }
    results.push({ key: retailer + ':' + kind, accepted: true, reason: null, observations: [observation] })
  }
  return {
    summary: {
      mode: 'reviewed-offline-only', sources: 6, acceptedSources: 6,
      rejectedSources: 0, observations: 6, productionEnabled: false,
      permissionVerified: false, publicSavingsClaimEligible: false,
    }, results,
  }
}

const py = (args, opts = {}) => spawnSync('python3', args, {
  encoding: 'utf8', timeout: 20000, ...opts,
})
async function inSandbox(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-retailer-db-'))
  try { return await fn(dir) }
  finally { await rm(dir, { recursive: true, force: true }) }
}
async function invoke(dir, data) {
  const input = join(dir, 'validated.json')
  const output = join(dir, 'retailer.db')
  await writeFile(input, JSON.stringify(data))
  return { input, output, result: py([command, '--input', input, '--out', output]) }
}
const query = (path, sql) => {
  const code = 'import sqlite3,sys,json; db=sqlite3.connect(sys.argv[1]);print(json.dumps(db.execute(sys.argv[2]).fetchall()))'
  const result = py(['-c', code, path, sql])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}

test('universal SQLite: 6 independently reviewed retailer adapters keep 4 product identities but 6 immutable price observations', () => inSandbox(async dir => {
  const run = await invoke(dir, batch())
  assert.equal(run.result.status, 0, run.result.stderr)
  assert.deepEqual(JSON.parse(run.result.stdout), {
    created: true, observations: 6, productionEnabled: false,
    products: 4, publicSavingsClaimEligible: false, snapshots: 6,
  })
  assert.equal((await stat(run.output)).mode & 0o777, 0o600)
  assert.deepEqual(query(run.output, 'SELECT retailer_id, COUNT(*) FROM products GROUP BY retailer_id ORDER BY retailer_id'), [
    ['dekamarkt', 2], ['plus', 2],
  ])
  assert.deepEqual(query(run.output, 'SELECT kind, COUNT(*) FROM source_snapshots GROUP BY kind ORDER BY kind'), [
    ['catalog', 2], ['offers', 2], ['product', 2],
  ])
  assert.deepEqual(query(run.output, 'SELECT COUNT(*) FROM price_observations WHERE availability="unknown"'), [[6]])
  assert.deepEqual(query(run.output, 'SELECT value FROM metadata WHERE key="production_enabled"'), [['false']])
  assert.deepEqual(query(run.output, 'SELECT price_cents FROM price_observations WHERE offer_label IS NOT NULL ORDER BY price_cents'), [[89], [89]])
  const rerun = py([command, '--input', run.input, '--out', run.output])
  assert.notEqual(rerun.status, 0, 'never replace an earlier provenance database')
  assert.deepEqual(query(run.output, 'SELECT COUNT(*) FROM price_observations'), [[6]])
}))

test('universal SQLite: conflicting product name across independently captured source kinds aborts transaction and leaves no DB', () => inSandbox(async dir => {
  const data = batch()
  data.results.find(e => e.key === 'plus:catalog').observations[0].name = 'Different misleading product'
  const run = await invoke(dir, data)
  assert.notEqual(run.result.status, 0)
  await assert.rejects(stat(run.output), { code: 'ENOENT' })
}))

test('universal SQLite: cross-retailer source spoof, cent floats, forged permission, duplicate kinds and URL tricks fail closed', async t => {
  const cases = [
    ['foreign host', d => { d.results[0].observations[0].provenance.url = 'https://outside.invalid/product' }],
    ['credential URL', d => { d.results[0].observations[0].provenance.url = 'https://user:pass@www.plus.nl/producten' }],
    ['source mismatch', d => { d.results[0].observations[0].provenance.supermarket = 'dekamarkt' }],
    ['floating cent', d => { d.results[0].observations[0].currentPriceCents = 12.5 }],
    ['boolean cent', d => { d.results[0].observations[0].currentPriceCents = true }],
    ['future timestamp', d => { d.results[0].observations[0].provenance.capturedAt = '2030-01-01T00:00:00Z' }],
    ['invalid date', d => { d.results[0].observations[0].provenance.capturedAt = '2026-02-30T12:00:00Z' }],
    ['unsafe availability', d => { d.results[0].observations[0].availability = 'yes' }],
    ['missing adapter', d => { d.results.pop() }],
    ['duplicate adapter', d => { d.results[1].key = 'plus:product' }],
    ['false license claim', d => { d.summary.permissionVerified = true }],
    ['public money claim', d => { d.summary.publicSavingsClaimEligible = true }],
    ['mismatched count', d => { d.summary.observations = 50 }],
    ['unsafe product id', d => { d.results[0].observations[0].sourceProductId = '../escape' }],
  ]
  for (const [name, mutation] of cases) {
    await t.test(name, () => inSandbox(async dir => {
      const data = batch()
      mutation(data)
      const run = await invoke(dir, data)
      assert.notEqual(run.result.status, 0, 'expected rejected input: ' + name)
      await assert.rejects(stat(run.output), { code: 'ENOENT' })
    }))
  }
})

test('universal SQLite: malformed duplicate JSON provenance key is refused before database creation', () => inSandbox(async dir => {
  const input = join(dir, 'raw-duplicate.json')
  const output = join(dir, 'out.db')
  await writeFile(input, '{"summary":{"mode":"reviewed-offline-only","mode":"verified-production"},"results":[]}')
  const result = py([command, '--input', input, '--out', output])
  assert.notEqual(result.status, 0)
  await assert.rejects(stat(output), { code: 'ENOENT' })
}))
