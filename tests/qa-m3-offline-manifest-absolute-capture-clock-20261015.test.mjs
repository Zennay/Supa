import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// QA-owned, synthetic and offline only. Both HTML files are intentionally
// absent: a malformed capture clock must fail during the WHOLE manifest
// preflight, before either HTML snapshot is opened or parsed.
const now = Date.parse('2026-10-15T11:00:00Z')
const canonical = '2026-10-15T10:00:00Z'
const plus = { sourceId: 'plus-product-halfvolle-melk',
  htmlFile: 'missing-plus.html', capturedAt: canonical }
const deka = { sourceId: 'dekamarkt-product-halfvolle-melk',
  htmlFile: 'missing-deka.html', capturedAt: canonical }
const requirements = [{ id: 'milk', query: 'halfvolle melk',
  amount: 1000, unit: 'ml' }]

async function fixture(t, snapshots) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-qa-m3-clock-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const filename = join(folder, 'manifest.json')
  await writeFile(filename, JSON.stringify({
    version: 1, requirements, snapshots,
  }))
  return filename
}

// Date.parse accepts these strings, but none denotes a trustworthy,
// explicit point-in-time observation under the M3 source-price clock.
// In particular the parser must not turn a made-up date into March.
const invalid = [
  ['date-only', '2026-10-15'],
  ['timezone-free local clock', '2026-10-15T10:00:00'],
  ['RFC-2822 instead of ISO', 'Thu, 15 Oct 2026 10:00:00 GMT'],
  ['calendar day rolled into March', '2026-02-30T10:00:00Z'],
  ['impossible UTC offset +14:01', '2026-10-15T10:00:00+14:01'],
  ['impossible UTC offset +23:59', '2026-10-15T10:00:00+23:59'],
  ['impossible UTC offset -14:01', '2026-10-15T10:00:00-14:01'],
]
for (const [description, timestamp] of invalid) {
  for (const location of ['first', 'later']) {
    test('QA M3 capture-clock preflight rejects ' + description + ' at ' + location + ' source', async t => {
      assert.ok(Number.isFinite(Date.parse(timestamp)),
        'fixture must expose Date.parse permissiveness: ' + description)
      const snapshots = location === 'first'
        ? [{ ...plus, capturedAt: timestamp }, deka]
        : [plus, { ...deka, capturedAt: timestamp }]
      const filename = await fixture(t, snapshots)
      await assert.rejects(
        compareLocalRetailerSnapshots(filename, now),
        /Invalid bounded offline snapshot/,
        description + ', ' + location + ': validate before missing HTML is opened',
      )
    })
  }
}

for (const timestamp of [
  canonical,
  '2026-10-15T12:00:00+02:00',
  '2026-10-15T10:00:00.123456789Z',
  '2026-10-15T05:00:00-05:00',
]) {
  test('QA M3 capture-clock preflight preserves canonical absolute timestamp ' + timestamp, async t => {
    const filename = await fixture(t, [
      { ...plus, capturedAt: timestamp },
      { ...deka, capturedAt: timestamp },
    ])
    // Valid preflight must proceed to the ordinary filesystem read; a
    // missing source is not interchangeable with malformed chronology.
    await assert.rejects(compareLocalRetailerSnapshots(filename, now), /ENOENT/)
  })
}
