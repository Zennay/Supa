import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareSavedRetailerEvidence } from '../scripts/retailer-compare-reviewed-evidence.mjs'

// Fictional basket metadata only; deliberately nonexistent retailer files
// verify invalid demand aborts before *any* archived source file is opened.
const nowMs = Date.parse('2026-10-15T12:00:00Z')
const milk = { id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }
async function fixture(t, requirements) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-archived-preflight-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const demandPath = join(dir, 'requirements.json')
  await writeFile(demandPath, JSON.stringify(requirements))
  return [
    demandPath,
    join(dir, 'PLUS-absent-synthetic-evidence.json'),
    join(dir, 'DEKA-absent-synthetic-evidence.json'),
  ]
}
const malformed = [
  ['empty demand', [], /Invalid comparison input/],
  ['null demand', null, /Invalid comparison input/],
  ['duplicate ingredient identity', [milk, { ...milk, query: 'andere melk' }],
    /Invalid or duplicate ingredient requirement/],
  ['blank canonical ingredient query', [{ ...milk, query: ' ' }],
    /Invalid or duplicate ingredient requirement/],
  ['too many ingredients', Array.from({ length: 501 }, (_, index) => ({
    ...milk, id: 'item-' + index,
  })), /Invalid comparison input/],
]
for (const [label, invalid, error] of malformed) {
  test('M3 archived retailer preflight rejects ' + label + ' before source file I/O', async t => {
    const args = await fixture(t, invalid)
    await assert.rejects(compareSavedRetailerEvidence(...args, nowMs), error)
  })
}
test('invalid review clock refuses retailer file reads', async t => {
  const args = await fixture(t, [milk])
  await assert.rejects(compareSavedRetailerEvidence(...args, Number.NaN),
    /Invalid comparison input/)
})
test('valid demand still reaches archived source validation (no fake comparison)', async t => {
  const args = await fixture(t, [milk])
  await assert.rejects(compareSavedRetailerEvidence(...args, nowMs), /ENOENT/)
})
