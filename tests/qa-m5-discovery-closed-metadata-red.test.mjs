import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assessRetailerDiscovery } from '../scripts/m5-audit-retailer-discovery.mjs'

const original = JSON.parse(await readFile(new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url), 'utf8'))
const clone = () => structuredClone(original)

function ensureOnlyResearch(report) {
  assert.equal(report.sourceCount, 17)
  assert.equal(report.productionReady, false)
  assert.equal(report.milestone, 'M5 candidate research; not eligible during M3')
  assert.ok(report.sources.every(source =>
    source.productionEnabled === false &&
    source.sourceMechanism === 'unassessed' &&
    source.termsStatus === 'unreviewed'
  ))
}

test('M5 QA positive: all 17 original records remain disabled and audit never mutates the register', () => {
  const doc = clone()
  const serialized = JSON.stringify(doc)
  const first = assessRetailerDiscovery(doc)
  const second = assessRetailerDiscovery(clone())
  ensureOnlyResearch(first)
  assert.deepEqual(first, second, 'offline audit must be deterministic')
  assert.equal(JSON.stringify(doc), serialized)
})

test('M5 QA positive: candidate input ordering cannot change reviewed-rights outcome', () => {
  const doc = clone()
  doc.sources.reverse()
  const originalOrder = doc.sources.map(source => source.id)
  const report = assessRetailerDiscovery(doc)
  ensureOnlyResearch(report)
  assert.equal(report.blockers, 17)
  assert.deepEqual(report.sources.map(source => source.id),
    [...originalOrder].sort(), 'audit output must remain sorted regardless of input')
  assert.deepEqual(doc.sources.map(source => source.id), originalOrder,
    'audit must not sort or mutate original research input')
})

const rootCases = [
  ['productionEnabled', true],
  ['permissionGranted', true],
  ['ingestReady', true],
  ['licenseVerified', true],
]
for (const [key, value] of rootCases) {
  test(`M5 QA EXPECTED RED: root ${key} cannot silently claim unreviewed rights`, () => {
    const doc = clone()
    doc[key] = value
    const originalWithSpoofedMetadata = JSON.stringify(doc)
    assert.throws(() => assessRetailerDiscovery(doc),
      /schema|unknown|field|permission|production|unrecognized|unexpected/i)
    assert.equal(JSON.stringify(doc), originalWithSpoofedMetadata)
  })
}

const recordCases = [
  ['ingestAuthorized', true],
  ['licenseApproved', true],
  ['proxyOverridePermitted', true],
]
for (const [key, value] of recordCases) {
  test(`M5 QA EXPECTED RED: retailer ${key} cannot bypass explicit unknown metadata`, () => {
    const doc = clone()
    doc.sources[0][key] = value
    const before = JSON.stringify(doc)
    assert.throws(() => assessRetailerDiscovery(doc),
      /schema|unknown|field|permission|production|unrecognized|unexpected/i)
    assert.equal(JSON.stringify(doc), before)
  })
}

test('M5 QA EXPECTED RED: forged production purpose must not pass market research audit', () => {
  const doc = clone()
  doc.purpose = 'APPROVED production retailer ingest allowlist with permission'
  assert.throws(() => assessRetailerDiscovery(doc),
    /purpose|schema|production|permission|invalid/i)
})

test('M5 QA EXPECTED RED: real audit CLI must refuse hidden root production authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m5-schema-qa-'))
  const input = join(directory, 'fictional-rights-register.json')
  try {
    const doc = clone()
    doc.productionEnabled = true
    const inputBytes = JSON.stringify(doc, null, 2)
    await writeFile(input, inputBytes, 'utf8')
    const run = spawnSync(process.execPath, [
      new URL('../scripts/m5-audit-retailer-discovery.mjs', import.meta.url).pathname,
      input,
    ], { cwd: process.cwd(), encoding: 'utf8' })
    assert.equal(run.status, 1, 'CLI must refuse deceptive candidate JSON')
    assert.equal(run.stdout, '', 'refused metadata must not produce an apparently valid report')
    assert.equal(await readFile(input, 'utf8'), inputBytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
