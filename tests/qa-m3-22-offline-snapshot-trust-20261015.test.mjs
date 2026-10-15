import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmod, link, mkdtemp, readFile, readdir, rm, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalM3RetailerRequirements } from '../scripts/retailer-canonical-m3-demand.mjs'
import {
  compareOfflineM3RetailerBasket, validateOfflineM3SnapshotManifest,
} from '../scripts/retailer-m3-offline-22-snapshots.mjs'

// Independent QA fixture: all 22 sources are fictional LOCAL HTML. Tests never
// fetch actual PLUS/Deka data and do not authorize any production reuse.
const REQUIREMENTS = canonicalM3RetailerRequirements()
const NOW = Date.parse('2026-10-15T12:00:00Z')
const CLI = fileURLToPath(new URL('../scripts/retailer-m3-offline-22-snapshots.mjs', import.meta.url))
const PRIVATE_NOTE = 'FICTIONAL_PRIVATE_NOTE_MUST_NOT_LEAK'

function productHtml(item, index, price, availability = 'https://schema.org/InStock') {
  return '<!--' + PRIVATE_NOTE + '--><script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Product',
      sku: 'fictional-' + index,
      name: item.query,
      weight: { value: item.unit === 'piece' ? '1 st' : '1000 ' + item.unit },
      offers: {
        '@type': 'Offer', price, priceCurrency: 'EUR', availability,
      },
    }) + '</script>'
}

function manifestScaffold() {
  const products = []
  const snapshots = []
  for (const supermarket of ['plus', 'dekamarkt']) {
    for (const [i, item] of REQUIREMENTS.entries()) {
      const url = supermarket === 'plus'
        ? 'https://www.plus.nl/product/qa-fictional-' + i
        : 'https://www.dekamarkt.nl/producten/qa-fictional-' + i
      const htmlFile = supermarket + '-' + i + '.html'
      products.push({ supermarket, ingredientId: item.id, url })
      snapshots.push({
        supermarket, url, htmlFile, capturedAt: '2026-10-15T10:00:00Z',
      })
    }
  }
  return { version: 1, products, snapshots }
}

async function sourceTree(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-offline-22-'))
  await chmod(dir, 0o700)
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manifest = manifestScaffold()
  for (const row of manifest.snapshots) {
    const i = Number(row.htmlFile.match(/-(\d+)\.html$/)[1])
    const price = row.supermarket === 'plus' ? '1.50' : '1.25'
    await writeFile(join(dir, row.htmlFile), productHtml(REQUIREMENTS[i], i, price), { mode: 0o600 })
  }
  const path = join(dir, 'synthetic-operator-manifest.json')
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 })
  return { dir, path, manifest }
}

function cli(path) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', CLI, '--offline', path], {
    encoding: 'utf8', timeout: 20_000,
  })
  assert.equal(run.error, undefined, run.error?.message)
  return run
}

function assertPrivateSafe(result, path) {
  const visible = result.stdout + result.stderr
  for (const marker of [PRIVATE_NOTE, path, 'supa-qa-offline-22-', 'synthetic-operator-manifest.json']) {
    assert.equal(visible.includes(marker), false, 'operator-private file content or path leaked')
  }
}

test('M3 independent offline 22-file comparison is zero-network, read-only and never public savings proof', async t => {
  const { dir, path, manifest } = await sourceTree(t)
  const before = await readFile(path)
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('UNAUTHORIZED_NETWORK_MUST_NOT_OCCUR') }
  let report
  try {
    report = await compareOfflineM3RetailerBasket(path, NOW)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(report.provenance, 'operator-supplied-offline-html-preview')
  assert.equal(report.claimable, false)
  assert.equal(report.sourceRightsAsserted, false)
  assert.equal(report.requiredIngredientCount, 11)
  assert.equal(report.captureSummary.length, 22)
  assert.equal(report.comparison.lines.length, 11)
  assert.equal(report.comparison.comparable, true)
  assert.equal(report.comparison.cheaperStore, 'dekamarkt')
  assert.ok(report.comparison.savingsCents > 0, 'fictional technical comparator positive control')
  assert.equal(JSON.stringify(report).includes(PRIVATE_NOTE), false)
  const first = report.captureSummary[0]
  const source = await readFile(join(dir, manifest.snapshots[0].htmlFile))
  assert.equal(first.bytes, source.length)
  assert.equal(first.sha256, createHash('sha256').update(source).digest('hex'))
  assert.deepEqual(await readFile(path), before, 'the private manifest must not be changed')
  assert.equal((await readdir(dir)).length, 23, 'no generated artifacts or hidden side-effect files')
})

test('M3 independent offline snapshot order has no effect on same-demand decision or monetary facts', async t => {
  const { path, manifest } = await sourceTree(t)
  const initial = await compareOfflineM3RetailerBasket(path, NOW)
  manifest.snapshots.reverse()
  manifest.products.reverse()
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600 })
  const reordered = await compareOfflineM3RetailerBasket(path, NOW)
  assert.equal(reordered.comparison.comparable, initial.comparison.comparable)
  assert.equal(reordered.comparison.cheaperStore, initial.comparison.cheaperStore)
  assert.equal(reordered.comparison.savingsCents, initial.comparison.savingsCents)
  assert.equal(reordered.claimable, false)
  assert.equal(reordered.sourceRightsAsserted, false)
  assert.equal(reordered.captureSummary.length, 22)
})

test('M3 one unavailable fictional product withdraws whole offline savings outcome', async t => {
  const { dir, path } = await sourceTree(t)
  const file = join(dir, 'dekamarkt-4.html')
  await writeFile(file, productHtml(REQUIREMENTS[4], 4, '1.25', 'https://schema.org/PreOrder'), { mode: 0o600 })
  const report = await compareOfflineM3RetailerBasket(path, NOW)
  assert.equal(report.comparison.comparable, false)
  assert.equal(report.comparison.savingsCents, null)
  assert.equal(report.comparison.cheaperStore, null)
  assert.equal(report.claimable, false)
  assert.equal(report.sourceRightsAsserted, false)
})

test('M3 offline manifest rejects traversal, duplicate snapshot file and invalid calendar before source reads', () => {
  const examples = [
    m => { m.snapshots[0].htmlFile = '../private.html' },
    m => { m.snapshots[0].htmlFile = '/private.html' },
    m => { m.snapshots[0].htmlFile = 'nested/private.html' },
    m => { m.snapshots[1].htmlFile = m.snapshots[0].htmlFile },
    m => { m.snapshots[0].capturedAt = '2026-02-30T10:00:00Z' },
    m => { m.snapshots[0].capturedAt = '2026-10-15T10:00:00+14:01' },
    m => { m.snapshots[0].capturedAt = '2026-10-15T10:00:00+24:00' },
    m => { m.snapshots.pop() },
  ]
  for (const mutate of examples) {
    const manifest = manifestScaffold()
    mutate(manifest)
    assert.throws(() => validateOfflineM3SnapshotManifest(manifest),
      /Invalid or duplicate|one snapshot|coverage/, 'must fail preflight before any HTML IO')
  }
})

test('M3 offline CLI refuses multiply-linked private HTML without exposing file paths or raw private data', async t => {
  const { dir, path } = await sourceTree(t)
  const first = join(dir, 'plus-0.html')
  const alias = join(dir, 'copy-of-private.html')
  await link(first, alias)
  const output = cli(path)
  assert.notEqual(output.status, 0)
  assert.equal(output.stdout, '')
  assert.match(output.stderr, /^Private M3 offline comparison refused: /)
  assertPrivateSafe(output, path)
})

test('M3 offline CLI refuses oversized single HTML and never leaves a partial savings report', async t => {
  const { dir, path } = await sourceTree(t)
  const first = join(dir, 'plus-0.html')
  const tooLarge = Buffer.alloc(2 * 1024 * 1024 + 1, 0x78)
  await writeFile(first, tooLarge, { mode: 0o600 })
  const output = cli(path)
  assert.notEqual(output.status, 0)
  assert.equal(output.stdout, '')
  assertPrivateSafe(output, path)
  assert.equal((await readdir(dir)).length, 23)
})

test('M3 offline refuses invalid reference time before reading even an absent private file', async () => {
  const absent = '/unlikely-m3-qa-path/never-existing-private.json'
  for (const bad of [-1, NaN, Number.POSITIVE_INFINITY, 1.5]) {
    await assert.rejects(compareOfflineM3RetailerBasket(absent, bad),
      /Invalid offline M3 reference clock/)
  }
})
