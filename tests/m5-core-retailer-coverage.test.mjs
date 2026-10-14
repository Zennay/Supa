import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assessCoreRetailerCoverage, compareCoreRetailerInventories, CORE_MARKET_BANNERS } from '../scripts/m5-check-core-retailer-coverage.mjs'

const sourceFile = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const source = JSON.parse(await readFile(sourceFile, 'utf8'))
const copy = () => structuredClone(source)
const script = new URL('../scripts/m5-check-core-retailer-coverage.mjs', import.meta.url)

function call(input) {
  return spawnSync(process.execPath, [script.pathname, ...input], {
    encoding: 'utf8', timeout: 20_000,
  })
}

test('exact 13 core NL banners remain individually present; Boni is not absent', () => {
  assert.equal(CORE_MARKET_BANNERS.length, 13)
  assert.equal(new Set(CORE_MARKET_BANNERS).size, 13)
  const result = assessCoreRetailerCoverage(copy())
  assert.equal(result.coreCovered, true)
  assert.equal(result.requiredCount, 13)
  assert.equal(result.coveredRequiredCount, 13)
  assert.equal(result.candidateCount, 17)
  assert.deepEqual(result.missingRequiredIds, [])
  for (const id of ['boni', 'plus', 'dekamarkt', 'albert-heijn']) {
    assert.ok(CORE_MARKET_BANNERS.includes(id))
  }
})

test('four additional market candidates do not masquerade as licensed sources', () => {
  const result = assessCoreRetailerCoverage(copy())
  assert.deepEqual(result.additionalCandidateIds,
    ['boon', 'ekoplaza', 'nettorama', 'odin'])
  assert.equal(result.rightsVerified, false)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
  assert.equal(result.milestone, 'M3 active; M5 not eligible')
})

test('missing Boni is an explicit incomplete coverage result, not a success', () => {
  const doc = copy()
  doc.sources = doc.sources.filter((retailer) => retailer.id !== 'boni')
  const result = assessCoreRetailerCoverage(doc)
  assert.deepEqual(result.missingRequiredIds, ['boni'])
  assert.equal(result.coveredRequiredCount, 12)
  assert.equal(result.coreCovered, false)
  assert.equal(result.productionReady, false)
})

test('missing PLUS and DekaMarkt both fail closed despite 15 other brands', () => {
  const doc = copy()
  doc.sources = doc.sources.filter((row) => !['plus', 'dekamarkt'].includes(row.id))
  const result = assessCoreRetailerCoverage(doc)
  assert.deepEqual(result.missingRequiredIds, ['dekamarkt', 'plus'])
  assert.equal(result.coreCovered, false)
})

test('an unrelated new brand cannot substitute for a required banner', () => {
  const doc = copy()
  doc.sources = doc.sources.filter((row) => row.id !== 'boni')
  doc.sources.push({
    ...doc.sources[0],
    id: 'fictional-candidate',
    name: 'Fictional candidate only',
  })
  const result = assessCoreRetailerCoverage(doc)
  assert.equal(result.candidateCount, 17)
  assert.equal(result.coreCovered, false)
  assert.deepEqual(result.missingRequiredIds, ['boni'])
  assert.ok(result.additionalCandidateIds.includes('fictional-candidate'))
})

test('coverage checker never upgrades an explicit unauthorized permission', () => {
  const doc = copy()
  doc.sources[0].permissionStatus = 'approved'
  assert.throws(() => assessCoreRetailerCoverage(doc), /Unverified permission status/)
})

test('a forged operational purpose cannot use candidate completeness to authorize ingest', () => {
  const doc = copy()
  doc.purpose = 'production enabled'
  assert.throws(() => assessCoreRetailerCoverage(doc), /purpose/)
})

test('malformed root and arbitrary extra production claims fail via original auditor', () => {
  const doc = copy()
  doc.productionReady = true
  assert.throws(() => assessCoreRetailerCoverage(doc), /schema/)
})

test('ordinary coverage assessment does not mutate underlying owner register', () => {
  const doc = copy()
  const unchanged = structuredClone(doc)
  assessCoreRetailerCoverage(doc)
  assert.deepEqual(doc, unchanged)
})

test('normal CLI emits read-only non-authorizing JSON and exits 0', () => {
  const run = call([])
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  const report = JSON.parse(run.stdout)
  assert.equal(report.candidateCount, 17)
  assert.equal(report.coreCovered, true)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.productionReady, false)
})

test('CLI detects a missing required banner with exit 2, no fabricated eligibility', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-coverage-'))
  try {
    const input = join(dir, 'market-inventory.json')
    const doc = copy()
    doc.sources = doc.sources.filter((row) => row.id !== 'boni')
    await writeFile(input, JSON.stringify(doc), { mode: 0o600 })
    const run = call([input])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.deepEqual(result.missingRequiredIds, ['boni'])
    assert.equal(result.m5Eligible, false)
    assert.equal(result.rightsVerified, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('invalid schema CLI does not leak a private input path or file contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-private-'))
  try {
    const input = join(dir, 'PRIVATE-NOT-FOR-REPORT.json')
    await writeFile(input, '{"private":"do not echo"}', { mode: 0o600 })
    const run = call([input])
    assert.equal(run.status, 2)
    assert.equal(run.stdout, '')
    assert.match(run.stderr, /^Invalid offline retailer coverage input\n$/)
    assert.doesNotMatch(run.stderr, /PRIVATE|do not echo/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('unknown CLI options fail closed without source data', () => {
  const run = call(['--enable-production'])
  assert.equal(run.status, 2)
  assert.equal(run.stdout, '')
  assert.equal(run.stderr, 'Invalid offline retailer coverage input\n')
})

test('independent unchanged research inventories report no changes and no historical proof', () => {
  const result = compareCoreRetailerInventories(copy(), copy())
  assert.deepEqual(result.addedCandidateIds, [])
  assert.deepEqual(result.removedCandidateIds, [])
  assert.equal(result.changed, false)
  assert.equal(result.humanReviewRequired, false)
  assert.equal(result.historicalEvidenceVerified, false)
  assert.equal(result.rightsVerified, false)
  assert.equal(result.m5Eligible, false)
})

test('future inventory removal of an additional banner is visible even with core still complete', () => {
  const previous = copy()
  const current = copy()
  current.sources = current.sources.filter((source) => source.id !== 'odin')
  const report = compareCoreRetailerInventories(current, previous)
  assert.equal(report.coreCovered, true)
  assert.deepEqual(report.removedCandidateIds, ['odin'])
  assert.equal(report.changed, true)
  assert.equal(report.humanReviewRequired, true)
  assert.equal(report.productionReady, false)
})

test('previously missing valid candidate surfaces as added not as approved data', () => {
  const previous = copy()
  previous.sources = previous.sources.filter((source) => source.id !== 'boni')
  const report = compareCoreRetailerInventories(copy(), previous)
  assert.deepEqual(report.addedCandidateIds, ['boni'])
  assert.deepEqual(report.removedCandidateIds, [])
  assert.equal(report.coreCovered, true)
  assert.equal(report.rightsVerified, false)
  assert.equal(report.historicalEvidenceVerified, false)
})

test('compare refuses to treat same inventory object as historical evidence', () => {
  const current = copy()
  assert.throws(() => compareCoreRetailerInventories(current, current),
    /Distinct inventory inputs required/)
})

test('compare refuses separate wrappers around one sources array', () => {
  const current = copy()
  const previous = { ...current }
  assert.throws(() => compareCoreRetailerInventories(current, previous),
    /Distinct inventory inputs required/)
})

test('comparison validates owner schema before invoking malicious root sources accessor', () => {
  const current = copy()
  const previous = copy()
  let called = 0
  Object.defineProperty(previous, 'sources', {
    enumerable: true,
    get() { called++; throw Error('PRIVATE-RESEARCH-TRAP') },
  })
  assert.throws(() => compareCoreRetailerInventories(current, previous), /schema fields/)
  assert.equal(called, 0)
})

test('comparison CLI exits 2 on optional-banner removal and keeps rights false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-inventory-diff-'))
  try {
    const previous = join(dir, 'previous.json')
    const current = join(dir, 'current.json')
    await writeFile(previous, JSON.stringify(copy()), { mode: 0o600 })
    const changed = copy()
    changed.sources = changed.sources.filter((source) => source.id !== 'odin')
    await writeFile(current, JSON.stringify(changed), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.equal(result.coreCovered, true)
    assert.deepEqual(result.removedCandidateIds, ['odin'])
    assert.equal(result.historicalEvidenceVerified, false)
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('comparison CLI accepts independent identical valid copies without release claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-inventory-same-'))
  try {
    const previous = join(dir, 'previous.json')
    const current = join(dir, 'current.json')
    await writeFile(previous, JSON.stringify(copy()), { mode: 0o600 })
    await writeFile(current, JSON.stringify(copy()), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 0, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.equal(result.changed, false)
    assert.equal(result.historicalEvidenceVerified, false)
    assert.equal(result.rightsVerified, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('renamed retained banner is separately flagged for human market-identity review', () => {
  const current = copy()
  const previous = copy()
  const row = current.sources.find((entry) => entry.id === 'plus')
  row.name = 'PLUS market listing revision'
  const comparison = compareCoreRetailerInventories(current, previous)
  assert.deepEqual(comparison.addedCandidateIds, [])
  assert.deepEqual(comparison.removedCandidateIds, [])
  assert.deepEqual(comparison.changedCandidateIds, ['plus'])
  assert.equal(comparison.changed, true)
  assert.equal(comparison.humanReviewRequired, true)
  assert.equal(comparison.rightsVerified, false)
  assert.doesNotMatch(JSON.stringify(comparison), /market listing revision/)
})

test('an altered approved market-list citation does not pass as unchanged evidence', () => {
  const current = copy()
  const previous = copy()
  current.sources.find((row) => row.id === 'boni').researchUrl =
    'https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten'
  const comparison = compareCoreRetailerInventories(current, previous)
  assert.deepEqual(comparison.changedCandidateIds, ['boni'])
  assert.equal(comparison.screeningDateChanged, false)
  assert.equal(comparison.historicalEvidenceVerified, false)
})

test('global screening-date edits require human review without proving an observation', () => {
  const current = copy()
  const previous = copy()
  current.screenedAt = '2026-10-12'
  const comparison = compareCoreRetailerInventories(current, previous)
  assert.deepEqual(comparison.changedCandidateIds, [])
  assert.equal(comparison.screeningDateChanged, true)
  assert.equal(comparison.changed, true)
  assert.equal(comparison.humanReviewRequired, true)
  assert.equal(comparison.historicalEvidenceVerified, false)
  assert.equal(comparison.m5Eligible, false)
})

test('unchanged source content but reordered canonical candidates is not false drift', () => {
  const current = copy()
  current.sources.reverse()
  const comparison = compareCoreRetailerInventories(current, copy())
  assert.deepEqual(comparison.changedCandidateIds, [])
  assert.equal(comparison.screeningDateChanged, false)
  assert.equal(comparison.changed, false)
})

test('source name accessor is rejected by existing owner schema before diff', () => {
  const current = copy()
  const previous = copy()
  let calls = 0
  Object.defineProperty(current.sources[0], 'name', {
    enumerable: true,
    get() { calls++; throw Error('PRIVATE-IDENTITY-LEAK') },
  })
  assert.throws(() => compareCoreRetailerInventories(current, previous),
    /schema fields/)
  assert.equal(calls, 0)
})

test('name-only change exits 2 from actual CLI with opaque private identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-name-change-'))
  try {
    const previous = join(dir, 'past.json')
    const current = join(dir, 'now.json')
    const changed = copy()
    changed.sources.find((row) => row.id === 'plus').name = 'PRIVATE-CHANGED-IDENTITY'
    await writeFile(previous, JSON.stringify(copy()), { mode: 0o600 })
    await writeFile(current, JSON.stringify(changed), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.deepEqual(result.changedCandidateIds, ['plus'])
    assert.equal(result.coreCovered, true)
    assert.equal(result.rightsVerified, false)
    assert.doesNotMatch(run.stdout, /PRIVATE-CHANGED-IDENTITY/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('screening-date-only change exits 2 from CLI without creating source grant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-date-change-'))
  try {
    const previous = join(dir, 'previous.json')
    const current = join(dir, 'current.json')
    const changed = copy()
    changed.screenedAt = '2026-10-12'
    await writeFile(previous, JSON.stringify(copy()), { mode: 0o600 })
    await writeFile(current, JSON.stringify(changed), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.equal(result.screeningDateChanged, true)
    assert.equal(result.m5Eligible, false)
    assert.equal(result.productionReady, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('candidate addition requires explicit human review with nonzero CLI exit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-add-review-'))
  try {
    const previous = join(dir, 'previous.json')
    const current = join(dir, 'current.json')
    const old = copy()
    old.sources = old.sources.filter((row) => row.id !== 'odin')
    await writeFile(previous, JSON.stringify(old), { mode: 0o600 })
    await writeFile(current, JSON.stringify(copy()), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.deepEqual(result.addedCandidateIds, ['odin'])
    assert.deepEqual(result.removedCandidateIds, [])
    assert.equal(result.changed, true)
    assert.equal(result.humanReviewRequired, true)
    assert.equal(result.rightsVerified, false)
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('core candidate replacement cannot pass review by preserving total count', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-replace-review-'))
  try {
    const previous = join(dir, 'previous.json')
    const current = join(dir, 'current.json')
    const changed = copy()
    changed.sources = changed.sources.filter((row) => row.id !== 'boni')
    changed.sources.push({
      ...changed.sources[0],
      id: 'fictional-market-banner',
      name: 'Fictional market banner',
    })
    await writeFile(previous, JSON.stringify(copy()), { mode: 0o600 })
    await writeFile(current, JSON.stringify(changed), { mode: 0o600 })
    const run = call([current, '--baseline', previous])
    assert.equal(run.status, 2, run.stderr)
    const result = JSON.parse(run.stdout)
    assert.deepEqual(result.addedCandidateIds, ['fictional-market-banner'])
    assert.deepEqual(result.removedCandidateIds, ['boni'])
    assert.equal(result.coreCovered, false)
    assert.equal(result.candidateCount, undefined)
    assert.equal(result.m5Eligible, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
