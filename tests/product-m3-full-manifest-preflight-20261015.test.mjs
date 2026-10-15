import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Source HTML deliberately missing to prove every manifest entry is checked
// before touching first retailer capture. Every source and price is fictional.
const nowMs = Date.parse('2026-10-15T11:00:00.000Z')
const goodTime = '2026-10-15T10:00:00.000Z'
const plus = { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'missing-plus.html',
  capturedAt: goodTime }
const deka = { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'missing-deka.html',
  capturedAt: goodTime }
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]

async function manifest(t, snapshots, withFirstFile = false) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-manifest-preflight-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  if (withFirstFile) {
    await writeFile(join(root, plus.htmlFile),
      '<html><body>Fictional source without a product</body></html>')
  }
  const filename = join(root, 'manifest.json')
  await writeFile(filename, JSON.stringify({ version: 1, requirements, snapshots }))
  return filename
}
for (const [name, invalid, message] of [
  ['duplicate source identity', { ...deka, sourceId: plus.sourceId },
    /Invalid or duplicate offline snapshot reference/],
  ['duplicate HTML filename', { ...deka, htmlFile: plus.htmlFile },
    /Invalid or duplicate offline snapshot reference/],
  ['path traversal in a later row', { ...deka, htmlFile: '../outside.html' },
    /Invalid or duplicate offline snapshot reference/],
  ['unknown retailer on second row', { ...deka, sourceId: 'unknown-supermarket' },
    /Offline snapshot source is not on the allowlist/],
  ['missing second-row timestamp', { ...deka, capturedAt: null },
    /Invalid bounded offline snapshot/],
  ['unparseable second-row timestamp', { ...deka, capturedAt: 'tomorrowish' },
    /Invalid bounded offline snapshot/],
  ['extra nested path in a later row', { ...deka, htmlFile: 'folder/deka.html' },
    /Invalid or duplicate offline snapshot reference/],
]) {
  test('M3 preflights ' + name + ' before opening first HTML', async t => {
    const filename = await manifest(t, [plus, invalid])
    await assert.rejects(compareLocalRetailerSnapshots(filename, nowMs), message)
  })
}
test('valid whole manifest proceeds to ordinary bounded HTML read', async t => {
  const filename = await manifest(t, [plus, deka])
  await assert.rejects(compareLocalRetailerSnapshots(filename, nowMs), /ENOENT/)
})
test('complete valid manifest still yields offline no-money preview', async t => {
  const filename = await manifest(t, [plus, deka], true)
  const source = '<html><body>Other fictional source, no priced product</body></html>'
  await writeFile(join(filename, '..', deka.htmlFile), source)
  const result = await compareLocalRetailerSnapshots(filename, nowMs)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.comparable, false)
  assert.equal(result.comparison.cheaperStore, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.deepEqual(result.captureSummary.map(x => x.parsedProducts), [0, 0])
})
