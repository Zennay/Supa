import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareLocalRetailerSnapshots } from '../scripts/retailer-compare-local-snapshots.mjs'

// Fake HTML, fake brands and no network. The source file itself is physically
// pinned before processing, even if a path is later swapped by another process.
const time = '2026-10-15T10:00:00.000Z'
const nowMs = Date.parse('2026-10-15T11:00:00.000Z')
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m3-source-fd-pin-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const manifest = join(folder, 'manifest.json')
  const plus = join(folder, 'plus.html')
  const deka = join(folder, 'deka.html')
  const value = {
    version: 1,
    requirements: [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }],
    snapshots: [
      { sourceId: 'plus-product-halfvolle-melk', htmlFile: 'plus.html', capturedAt: time },
      { sourceId: 'dekamarkt-product-halfvolle-melk', htmlFile: 'deka.html', capturedAt: time },
    ],
  }
  await writeFile(manifest, JSON.stringify(value))
  return { folder, manifest, plus, deka }
}
test('M3 refuses symlink as the local offline manifest itself', async t => {
  const f = await fixture(t)
  const link = join(f.folder, 'indirect-manifest.json')
  await symlink(f.manifest, link)
  await assert.rejects(compareLocalRetailerSnapshots(link, nowMs),
    /Input is not a bounded ordinary file/)
})
test('M3 refuses symlinked PLUS HTML despite a well-shaped manifest', async t => {
  const f = await fixture(t)
  const outside = join(f.folder, 'fictional-original.html')
  await writeFile(outside, '<html>synthetic</html>')
  await symlink(outside, f.plus)
  await writeFile(f.deka, '<html>different</html>')
  await assert.rejects(compareLocalRetailerSnapshots(f.manifest, nowMs),
    /Input is not a bounded ordinary file/)
})
test('M3 refuses a Deka HTML symlink after reading a normal PLUS file', async t => {
  const f = await fixture(t)
  const outside = join(f.folder, 'fictional-original.html')
  await writeFile(outside, '<html>synthetic</html>')
  await writeFile(f.plus, '<html>other synthetic</html>')
  await symlink(outside, f.deka)
  await assert.rejects(compareLocalRetailerSnapshots(f.manifest, nowMs),
    /Input is not a bounded ordinary file/)
})
test('M3 refuses oversized local HTML snapshots', async t => {
  const f = await fixture(t)
  await writeFile(f.plus, Buffer.alloc(2 * 1024 * 1024 + 1, 32))
  await writeFile(f.deka, '<html>synthetic</html>')
  await assert.rejects(compareLocalRetailerSnapshots(f.manifest, nowMs),
    /Input is not a bounded ordinary file/)
})
test('ordinary pinned local documents still yield private no-money preview', async t => {
  const f = await fixture(t)
  await writeFile(f.plus, '<html>fictional no price from PLUS</html>')
  await writeFile(f.deka, '<html>fictional no price from DekaMarkt</html>')
  const report = await compareLocalRetailerSnapshots(f.manifest, nowMs)
  assert.equal(report.comparison.claimable, false)
  assert.equal(report.comparison.comparable, false)
  assert.equal(report.comparison.savingsCents, null)
  assert.equal(report.comparison.cheaperStore, null)
  assert.equal(report.captureSummary.length, 2)
})
