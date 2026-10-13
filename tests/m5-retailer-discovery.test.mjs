import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { assessRetailerDiscovery } from '../scripts/m5-audit-retailer-discovery.mjs'

const fixturePath = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const original = JSON.parse(await readFile(fixturePath, 'utf8'))
const clone = () => structuredClone(original)

test('M5 inventory covers publicly listed NL retailers without production permission', () => {
  const report = assessRetailerDiscovery(clone())
  assert.equal(report.sourceCount, 16)
  assert.equal(report.productionReady, false)
  assert.deepEqual(report.sources.map((s) => s.id),
    [...report.sources.map((s) => s.id)].sort())
  assert.ok(report.sources.some((s) => s.id === 'plus'))
  assert.ok(report.sources.some((s) => s.id === 'dekamarkt'))
  assert.ok(report.sources.every((s) => s.productionEnabled === false))
  assert.ok(report.sources.every((s) => s.sourceMechanism === 'unassessed'))
  assert.equal(JSON.stringify(original), JSON.stringify(clone()), 'audit must not mutate input')
})

test('source discovery is not a backdoor around M1 data rights', () => {
  for (const [field, value] of [
    ['productionEnabled', true],
    ['productionEnabled', 'false'],
    ['permissionStatus', 'permitted'],
    ['permissionStatus', 'approved'],
    ['sourceMechanism', 'html-scraper'],
    ['sourceMechanism', 'licensed-feed'],
    ['researchUrl', 'http://invalid.example/path'],
    ['researchUrl', 'https://user:pass@invalid.example/'],
    ['name', 'ALDI\\u202e']
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

test('CLI produces a non-authorizing report and --require-production-ready exits 2', () => {
  const cli = new URL('../scripts/m5-audit-retailer-discovery.mjs', import.meta.url)
  const ordinary = spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8' })
  assert.equal(ordinary.status, 0, ordinary.stderr)
  const report = JSON.parse(ordinary.stdout)
  assert.equal(report.productionReady, false)
  assert.equal(report.sourceCount, 16)
  const gated = spawnSync(process.execPath, [cli.pathname, '--require-production-ready'], { encoding: 'utf8' })
  assert.equal(gated.status, 2)
  assert.equal(JSON.parse(gated.stdout).productionReady, false)
})
