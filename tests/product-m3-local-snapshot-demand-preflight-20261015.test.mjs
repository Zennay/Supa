import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Entirely fictional local-file manifest. Missing HTML files intentionally
// demonstrate that invalid demand is rejected *before* retailer capture I/O.
const at = '2026-10-15T10:00:00Z'
const nowMs = Date.parse('2026-10-15T11:00:00Z')
const milk = { id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }
async function createManifest(t, requirements) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-local-demand-preflight-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const filename = join(folder, 'manifest.json')
  await writeFile(filename, JSON.stringify({
    version: 1, requirements,
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk',
        htmlFile: 'missing-plus.html', capturedAt: at },
      { sourceId: 'dekamarkt-product-halfvolle-melk',
        htmlFile: 'missing-deka.html', capturedAt: at },
    ],
  }))
  return filename
}
const invalidDemand = [
  ['empty list', [], /Invalid comparison input/],
  ['duplicate requirement ID', [milk, { ...milk, query: 'weer melk' }],
    /Invalid or duplicate ingredient requirement/],
  ['blank query', [{ ...milk, query: ' ' }],
    /Invalid or duplicate ingredient requirement/],
  ['501 distinct requirements', Array.from({ length: 501 }, (_, i) => ({
    ...milk, id: 'ingredient-' + i,
  })), /Invalid comparison input/],
]
for (const [name, requirements, expected] of invalidDemand) {
  test('local M3 source files are not opened for ' + name, async t => {
    const manifest = await createManifest(t, requirements)
    await assert.rejects(compareLocalRetailerSnapshots(manifest, nowMs), expected)
  })
}
test('impossible M3 review clock aborts before HTML file I/O', async t => {
  const manifest = await createManifest(t, [milk])
  await assert.rejects(compareLocalRetailerSnapshots(manifest, Number.NaN),
    /Invalid comparison input/)
})
test('valid demand still reaches the ordinary bounded HTML-file read', async t => {
  const manifest = await createManifest(t, [milk])
  await assert.rejects(compareLocalRetailerSnapshots(manifest, nowMs), /ENOENT/)
})
test('valid incomplete demand remains a safe preview candidate, not a preflight exception', async t => {
  const manifest = await createManifest(t, [{ ...milk, amount: null }])
  await assert.rejects(compareLocalRetailerSnapshots(manifest, nowMs), /ENOENT/)
})
