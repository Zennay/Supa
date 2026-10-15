import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

const at = '2026-10-15T10:00:00Z'
const now = Date.parse('2026-10-15T11:00:00Z')
const plus = { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'missing-plus.html', capturedAt: at }
const deka = { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'missing-deka.html', capturedAt: at }
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]

async function manifest(t, snapshots) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-product-clock-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'manifest.json')
  await writeFile(path, JSON.stringify({ version: 1, requirements, snapshots }))
  return path
}

// All malformed entries are rejected in the complete manifest preflight,
// before either nonexistent HTML file can be opened.
for (const value of [
  '2026-10-15',
  '2026-10-15T10:00:00',
  'Thu, 15 Oct 2026 10:00:00 GMT',
  '2026-02-30T10:00:00Z',
  '2026-10-15T10:00:00+14:01',
  '2026-10-15T10:00:00-14:01',
  '2026-10-15T10:00:00+23:59',
  '2026-10-15T24:00:00Z',
  '2026-10-15T10:00:60Z',
  '2026-10-15T10:00:00.1234567890Z',
  '2026-10-15T10:00:00+02:60',
]) {
  for (const slot of [0, 1]) {
    test('M3 rejects invalid source time ' + value + ' at source slot ' + slot, async t => {
      const snapshots = [{ ...plus }, { ...deka }]
      snapshots[slot].capturedAt = value
      const path = await manifest(t, snapshots)
      await assert.rejects(compareLocalRetailerSnapshots(path, now),
        /Invalid bounded offline snapshot/)
    })
  }
}

for (const value of [
  at,
  '2026-10-15T12:00:00+02:00',
  '2026-10-15T05:00:00-05:00',
  '2026-10-15T10:00:00.123456789Z',
  '2026-10-15T10:00:00+14:00',
  '2026-10-15T10:00:00-14:00',
]) {
  test('M3 preserves valid absolute source time ' + value, async t => {
    const path = await manifest(t, [{ ...plus, capturedAt: value }, { ...deka, capturedAt: value }])
    await assert.rejects(compareLocalRetailerSnapshots(path, now), /ENOENT/)
  })
}
