import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, symlink, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareSavedRetailerEvidence } from '../scripts/retailer-compare-reviewed-evidence.mjs'

// Synthetic archived retailer evidence only. No source fetch or real prices.
const now = Date.parse('2026-10-15T11:00:00Z')
const demand = [{ id: 'milk', query: 'halfvolle melk', amount: 1000, unit: 'ml' }]
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-fd-pin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const requirements = join(dir, 'requirements.json')
  await writeFile(requirements, JSON.stringify(demand))
  return { dir, requirements, plus: join(dir, 'plus.json'), deka: join(dir, 'deka.json') }
}
test('M3 refuses pre-existing symlink used as PLUS archived evidence', async t => {
  const f = await fixture(t)
  const target = join(f.dir, 'fictional-target.json')
  await writeFile(target, JSON.stringify({ evidenceType: 'plus-browser-rendered-catalog' }))
  await symlink(target, f.plus)
  await writeFile(f.deka, '{}')
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Offline evidence file must be bounded and non-symlinked/)
})
test('M3 refuses pre-existing symlink used as Deka archived evidence', async t => {
  const f = await fixture(t)
  const target = join(f.dir, 'fictional-target.json')
  await writeFile(target, '{}')
  await writeFile(f.plus, '{}')
  await symlink(target, f.deka)
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Offline evidence file must be bounded and non-symlinked/)
})
test('M3 refuses archived evidence replaced by a directory', async t => {
  const f = await fixture(t)
  await mkdir(f.plus)
  await writeFile(f.deka, '{}')
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Offline evidence file must be bounded and non-symlinked/)
})
test('M3 refuses archive larger than the bounded 5 MiB limit', async t => {
  const f = await fixture(t)
  await writeFile(f.plus, Buffer.alloc(5 * 1024 * 1024 + 1, 32))
  await writeFile(f.deka, '{}')
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Offline evidence file must be bounded and non-symlinked/)
})
test('regular small JSON reaches existing evidence validation (not a file descriptor error)', async t => {
  const f = await fixture(t)
  await writeFile(f.plus, '{}')
  await writeFile(f.deka, '{}')
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Untrusted retailer evidence prevents basket comparison/)
})
test('malformed archived JSON still fails parsing and never fabricates money', async t => {
  const f = await fixture(t)
  await writeFile(f.plus, '{broken-json')
  await writeFile(f.deka, '{}')
  await assert.rejects(compareSavedRetailerEvidence(f.requirements, f.plus, f.deka, now),
    /Expected property name|Unexpected token|JSON/)
})
