import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Strictly fictional, local HTML fixtures; no retailer requests or licenses.
const capturedAt = '2026-10-15T10:00:00Z'
const nowMs = Date.parse('2026-10-15T11:00:00Z')
const requirement = { id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }
const plus = 'plus-product-halfvolle-melk'
const deka = 'dekamarkt-product-halfvolle-melk'

async function fixture(t, snapshots, files) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-replayed-capture-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf8')
  }
  const manifest = {
    version: 1, requirements: [requirement],
    snapshots: snapshots.map(([sourceId, htmlFile]) => ({ sourceId, htmlFile, capturedAt })),
  }
  const path = join(dir, 'manifest.json')
  await writeFile(path, JSON.stringify(manifest))
  return { path, manifest }
}

const fiction = '<html><body>synthetic supplier page without price</body></html>'
const distinct = '<html><body>distinct synthetic supplier page</body></html>'

test('M3 refuses one HTML file replayed as both PLUS and DekaMarkt', async t => {
  const input = await fixture(t, [
    [plus, 'same.html'], [deka, 'same.html'],
  ], { 'same.html': fiction })
  const before = JSON.stringify(input.manifest)
  await assert.rejects(
    compareLocalRetailerSnapshots(input.path, nowMs),
    /Invalid or duplicate offline snapshot reference/,
  )
  assert.equal(JSON.stringify(input.manifest), before)
})

test('M3 refuses byte-identical copies under different retailer filenames', async t => {
  const input = await fixture(t, [
    [plus, 'plus.html'], [deka, 'deka.html'],
  ], { 'plus.html': fiction, 'deka.html': fiction })
  await assert.rejects(
    compareLocalRetailerSnapshots(input.path, nowMs),
    /Duplicate offline HTML capture reused across sources/,
  )
})

test('M3 refuses replayed actual Product JSON-LD, not merely empty HTML', async t => {
  const embedded = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    sku: 'synthetic-milk-1', name: 'Halfvolle melk', weight: { value: '1000 ml' },
    offers: { '@type': 'Offer', price: '1.39', priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock' },
  }) + '</script>'
  const input = await fixture(t, [
    [plus, 'plus.html'], [deka, 'deka.html'],
  ], { 'plus.html': embedded, 'deka.html': embedded })
  await assert.rejects(
    compareLocalRetailerSnapshots(input.path, nowMs),
    /Duplicate offline HTML capture reused across sources/,
  )
})

test('distinct physical offline snapshots still yield a private no-money preview', async t => {
  const input = await fixture(t, [
    [plus, 'plus.html'], [deka, 'deka.html'],
  ], { 'plus.html': fiction, 'deka.html': distinct })
  const actual = await compareLocalRetailerSnapshots(input.path, nowMs)
  assert.equal(actual.format, 'supa-local-snapshot-comparison-v1')
  assert.equal(actual.comparison.claimable, false)
  assert.equal(actual.comparison.comparable, false)
  assert.equal(actual.comparison.savingsCents, null)
  assert.equal(actual.comparison.cheaperStore, null)
  assert.equal(actual.captureSummary.length, 2)
  assert.notEqual(actual.captureSummary[0].sha256, actual.captureSummary[1].sha256)
})
