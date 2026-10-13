import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { assessRetailerDiscovery } from '../scripts/m5-audit-retailer-discovery.mjs'

const fixturePath = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const original = JSON.parse(await readFile(fixturePath, 'utf8'))
const clone = () => structuredClone(original)

test('M5 inventory covers publicly listed NL retailers without production permission', () => {
  const report = assessRetailerDiscovery(clone())
  assert.equal(report.sourceCount, 17)
  assert.equal(report.productionReady, false)
  assert.deepEqual(report.sources.map((s) => s.id),
    [...report.sources.map((s) => s.id)].sort())
  assert.ok(report.sources.some((s) => s.id === 'plus'))
  assert.ok(report.sources.some((s) => s.id === 'boni'))
  assert.ok(report.sources.some((s) => s.id === 'dekamarkt'))
  assert.ok(report.sources.every((s) => s.productionEnabled === false))
  assert.ok(report.sources.every((s) => s.sourceMechanism === 'unassessed'))
  assert.ok(report.sources.every((s) => s.termsStatus === 'unreviewed' && s.robotsStatus === 'unreviewed'))
  assert.equal(JSON.stringify(original), JSON.stringify(clone()), 'audit must not mutate input')
})

test('source discovery is not a backdoor around M1 data rights', () => {
  for (const [field, value] of [
    ['productionEnabled', true],
    ['productionEnabled', 'false'],
    ['permissionStatus', 'permitted'],
    ['permissionStatus', 'approved'],
    ['permissionStatus', 'permission-requested'],
    ['permissionStatus', 'denied'],
    ['sourceMechanism', 'html-scraper'],
    ['sourceMechanism', 'licensed-feed'],
    ['regionScope', 'nationwide'],
    ['termsStatus', 'accepted'],
    ['robotsStatus', 'permitted'],
    ['dataOwner', 'some-retailer'],
    ['contactStatus', 'contacted'],
    ['expectedRefresh', 'hourly'],
    ['riskStatus', 'low'],
    ['priority', 'P1'],
    ['permissionEvidence', 'https://example.invalid/approval'],
    ['researchUrl', 'http://invalid.example/path'],
    ['researchUrl', 'https://user:pass@invalid.example/'],
    ['researchUrl', 'https://www.wur.nl.evil.example/nl/onderzoek'],
    ['researchUrl', 'https://example.invalid/fictional-market-list'],
    ['researchUrl', 'https://www.wur.nl/'],
    ['researchUrl', 'https://www.consumentenbond.nl@evil.example/'],
    ['researchUrl', 'https://www.consumentenbond.nl/voedingstests/prijspeiling-supermarkten?tracking=1'],
    ['name', 'ALDI' + String.fromCodePoint(0x202e)]
  ]) {
    const doc = clone()
    doc.sources[0][field] = value
    assert.throws(() => assessRetailerDiscovery(doc), undefined, field)
  }
})

test('malformed or competing identity and future milestone fail closed', () => {
  const checks = [
    (d) => { d.sources[1].id = d.sources[0].id },
    (d) => { d.sources[0].id = '../evil' },
    (d) => { d.sources = [] },
    (d) => { d.sources = Array.from({ length: 101 }, (_, i) => ({ ...d.sources[0], id: `store-${i}` })) },
    (d) => { d.screenedAt = '2999-01-01' },
    (d) => { d.screenedAt = '2026-02-30' },
    (d) => { d.milestone = 'M5 Live' },
    (d) => { d.version = 2 },
  ]
  for (const change of checks) {
    const doc = clone()
    change(doc)
    assert.throws(() => assessRetailerDiscovery(doc))
  }
})

test('closed root and retailer schema rejects all unauthorized rights metadata (#2097)', () => {
  const cases = [
    ['root productionEnabled', d => { d.productionEnabled = true }],
    ['root permissionGranted', d => { d.permissionGranted = true }],
    ['root ingestReady', d => { d.ingestReady = true }],
    ['root licenseVerified', d => { d.licenseVerified = true }],
    ['retailer ingestAuthorized', d => { d.sources[0].ingestAuthorized = true }],
    ['retailer licenseApproved', d => { d.sources[0].licenseApproved = true }],
    ['retailer proxyOverridePermitted', d => { d.sources[0].proxyOverridePermitted = true }],
    ['forged purpose', d => { d.purpose = 'APPROVED operational production ingest allowlist' }],
    ['missing purpose', d => { delete d.purpose }],
    ['missing required retailer name', d => { delete d.sources[0].name }],
    ['unknown nested extension', d => { d.sources[0].approval = { authority: 'production' } }],
  ]
  for (const [label, mutate] of cases) {
    const document = clone()
    mutate(document)
    const before = JSON.stringify(document)
    assert.throws(() => assessRetailerDiscovery(document),
      /schema|missing|unexpected|purpose|permission|production/i, label)
    assert.equal(JSON.stringify(document), before, label + ': input must not change')
  }
})

test('invisible/accessor-based rights flags are never silently ignored', () => {
  const doc = clone()
  Object.defineProperty(doc, 'ingestAuthorized', { value: true, enumerable: false })
  assert.throws(() => assessRetailerDiscovery(doc), /schema fields/i)
  const doc2 = clone()
  Object.defineProperty(doc2.sources[0], 'licenseGranted', { value: true, enumerable: false })
  assert.throws(() => assessRetailerDiscovery(doc2), /schema fields/i)
  const doc3 = clone()
  let invoked = false
  Object.defineProperty(doc3, 'purpose', {
    enumerable: true,
    get() { invoked = true; return 'M5 exploratory retailer discovery only' },
  })
  assert.throws(() => assessRetailerDiscovery(doc3), /schema fields/i)
  assert.equal(invoked, false, 'audit must not invoke suspicious accessor')
})

test('real M5 CLI refuses deceptive rights metadata without generating a ready report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m5-forged-rights-'))
  try {
    const input = join(dir, 'fictional-discovery.json')
    const document = clone()
    document.productionEnabled = true
    const originalBytes = JSON.stringify(document)
    await writeFile(input, originalBytes, { mode: 0o600 })
    const cli = new URL('../scripts/m5-audit-retailer-discovery.mjs', import.meta.url)
    const run = spawnSync(process.execPath, [cli.pathname, input], {
      encoding: 'utf8', timeout: 20000,
    })
    assert.notEqual(run.status, 0)
    assert.equal(run.stdout, '', 'failed audit must not emit ready JSON')
    assert.equal(await readFile(input, 'utf8'), originalBytes, 'input must not change')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('CLI produces a non-authorizing report and --require-production-ready exits 2', () => {
  const cli = new URL('../scripts/m5-audit-retailer-discovery.mjs', import.meta.url)
  const ordinary = spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8' })
  assert.equal(ordinary.status, 0, ordinary.stderr)
  const report = JSON.parse(ordinary.stdout)
  assert.equal(report.productionReady, false)
  assert.equal(report.sourceCount, 17)
  const gated = spawnSync(process.execPath, [cli.pathname, '--require-production-ready'], { encoding: 'utf8' })
  assert.equal(gated.status, 2)
  assert.equal(JSON.parse(gated.stdout).productionReady, false)
})
