import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  canonicalM3RetailerRequirements,
  main as exportCanonicalDemand,
} from '../scripts/retailer-canonical-m3-demand.mjs'

// Product-core M3 contract: bridge canonical planner demand into the already
// implemented offline catalog comparator, without inventing any retailer data.
test('exact M2-derived 11 ingredient IDs, quantities and units reach catalog format unchanged', () => {
  const sheet = buildObservationSheet()
  const requirements = canonicalM3RetailerRequirements()
  assert.equal(sheet.plannerFixture, 'm2-default-week')
  assert.equal(sheet.selectedMealCount, 4)
  assert.equal(sheet.requirements.length, 11)
  assert.deepEqual(requirements, sheet.requirements.map(({ id, query, amount, unit }) =>
    ({ id, query, amount, unit })))
  assert.equal(new Set(requirements.map(r => r.id)).size, 11)
  assert.equal(requirements.every(r => Number.isFinite(r.amount) && r.amount > 0), true)
  assert.equal(requirements.every(r =>
    Object.keys(r).sort().join(',') === 'amount,id,query,unit'), true)
  assert.equal(JSON.stringify(requirements).includes('priceCents'), false)
  assert.equal(JSON.stringify(requirements).includes('participantKey'), false)
  assert.equal(JSON.stringify(requirements).includes('sourceUrl'), false)
})

test('exported canonical requirements are independent of caller mutations and not field evidence', () => {
  const first = canonicalM3RetailerRequirements()
  first[0].amount = -1
  first[0].query = 'forged price'
  const second = canonicalM3RetailerRequirements()
  assert.ok(second[0].amount > 0)
  assert.notEqual(second[0].query, first[0].query)
  assert.ok(second.some(r => /broccoli|edamame|kippendij/i.test(r.query)))
})

test('offline M3 requirement export creates a private file and never overwrites existing evidence', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m3-requirements-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = join(folder, '11-lines.json')
  await exportCanonicalDemand(['--out', file])
  const before = await readFile(file, 'utf8')
  assert.deepEqual(JSON.parse(before), canonicalM3RetailerRequirements())
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  await assert.rejects(exportCanonicalDemand(['--out', file]), { code: 'EEXIST' })
  assert.equal(await readFile(file, 'utf8'), before)
})

test('invalid arguments cannot silently create or replace an observed study', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'supa-m3-requirements-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const file = join(folder, 'protected.json')
  await writeFile(file, 'human observation protected')
  for (const args of [
    ['--out'], ['--out', ''], ['--output', file], ['--out', file, '--force'],
    ['study.json'], ['--overwrite', file],
  ]) {
    await assert.rejects(exportCanonicalDemand(args), /Usage/)
  }
  assert.equal(await readFile(file, 'utf8'), 'human observation protected')
})
