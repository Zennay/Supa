import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assessCoreRetailerCoverage, CORE_MARKET_BANNERS } from '../scripts/m5-check-core-retailer-coverage.mjs'

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
