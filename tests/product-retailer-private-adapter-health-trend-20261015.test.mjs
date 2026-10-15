import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { comparePrivateAdapterHealth, main } from '../scripts/retailer-private-adapter-health-trend.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

const copy = x => structuredClone(x)
const clock = b => new Date(Math.max(...b.results.flatMap(row =>
  row.observations.map(fact => Date.parse(fact.provenance.capturedAt)))) + 3600000).toISOString()
async function baseline() {
  const batch = await loadReviewedRepositoryFixtures()
  return { batch, report: evaluatePrivateAdapterHealth(batch, { referenceTime: clock(batch) }) }
}
describe('product: private aggregate six-shape health trend', () => {
  it('unchanged real reviewed evidence has zero deltas and no invented retailer changes', async () => {
    const { report } = await baseline()
    const trend = comparePrivateAdapterHealth(report, copy(report))
    assert.deepEqual(trend.reviewSignals, [])
    assert.equal(trend.datasetRegressionSignalsDetected, false)
    assert.deepEqual(trend.newlyMissingShapes, [])
    assert.equal(trend.totalProductDelta, 0)
    assert.equal(trend.totalObservationDelta, 0)
    assert.equal(trend.productionEnabled, false)
    assert.equal(trend.publicSavingsClaimEligible, false)
    assert.equal(trend.livePricesAvailable, false)
    assert.equal(trend.externalRequests, 0)
  })
  it('detects a rejected six-source adapter in an actual re-ingested source batch', async () => {
    const { batch, report } = await baseline()
    const edited = copy(batch)
    const slot = edited.results[0]
    const count = slot.observations.length
    slot.accepted = false
    slot.reason = 'adapter-abstained'
    slot.observations = []
    edited.summary.acceptedSources--
    edited.summary.rejectedSources++
    edited.summary.observations -= count
    edited.summary.retailerCounts[slot.key.split(':')[0]] -= count
    const next = evaluatePrivateAdapterHealth(edited, { referenceTime: clock(batch) })
    const trend = comparePrivateAdapterHealth(report, next)
    assert.deepEqual(trend.newlyMissingShapes, [slot.key])
    assert.ok(trend.reviewSignals.includes('new-missing-source-shape'))
    assert.ok(trend.reviewSignals.includes('more-rejected-source-shapes'))
    assert.ok(trend.reviewSignals.includes('fewer-accepted-sources'))
    assert.ok(trend.totalObservationDelta < 0)
    assert.equal(trend.perShape[slot.key].acceptedDelta, -1)
    assert.equal(trend.perShape[slot.key].rejectedDelta, 1)
    assert.equal(trend.datasetRegressionSignalsDetected, true)
  })
  it('detects changes in offline historical age, not inferred store availability', async () => {
    const { batch, report } = await baseline()
    const future = new Date(Date.parse(clock(batch)) + 50 * 24 * 3600000).toISOString()
    const candidate = evaluatePrivateAdapterHealth(batch, { referenceTime: future })
    const trend = comparePrivateAdapterHealth(report, candidate)
    assert.ok(trend.reviewSignals.includes('more-stale-captures'))
    assert.equal(trend.context, 'offline-reviewed-dataset-differences-only')
  })
  it('remains deterministic under valid identical JSON round-tripping', async () => {
    const { report } = await baseline()
    const trend = comparePrivateAdapterHealth(report, JSON.parse(JSON.stringify(report)))
    assert.deepEqual(trend, comparePrivateAdapterHealth(copy(report), copy(report)))
  })
  it('rejects contradictions in nested coverage counters and outer totals', async () => {
    const { report } = await baseline()
    for (const mutation of [
      r => { r.sources++ },
      r => { r.observations++ },
      r => { r.byShape['plus:offers'].accepted++ },
      r => { r.byShape['plus:offers'].unknownPrices++ },
      r => { r.byShape['plus:product'].staleCaptures = 999 },
      r => { r.sixShapeCoverageComplete = false },
      r => { r.historicalFreshnessWithinWindow = !r.historicalFreshnessWithinWindow },
      r => { r.missingSourceKinds = ['plus:product'] },
      r => { r.operatorActions = [] },
    ]) {
      const forged = copy(report)
      mutation(forged)
      assert.throws(() => comparePrivateAdapterHealth(report, forged), /refused/)
    }
  })
  it('rejects extra fields, permission/publication promotion and incompatible thresholds', async () => {
    const { report } = await baseline()
    for (const mutation of [
      r => { r.secret = 'fictional-secret' },
      r => { r.productionEnabled = true },
      r => { r.permissionVerified = true },
      r => { r.publicSavingsClaimEligible = true },
      r => { r.livePricesAvailable = true },
      r => { r.byShape['dekamarkt:catalog'].captureUrl = 'https://example.com' },
      r => { r.maxAgeHours = 48 },
    ]) {
      const forged = copy(report)
      mutation(forged)
      assert.throws(() => comparePrivateAdapterHealth(report, forged), /refused/)
    }
  })
  it('CLI accepts two private 0600 canonical reports but prints no product, URL or SHA', async () => {
    const { report } = await baseline()
    const root = await mkdtemp(join(tmpdir(), 'supa-review-health-'))
    try {
      const before = join(root, 'before.json')
      const after = join(root, 'after.json')
      await writeFile(before, JSON.stringify(report), { mode: 0o600, flag: 'wx' })
      await writeFile(after, JSON.stringify(report), { mode: 0o600, flag: 'wx' })
      let output = ''
      await main(['--before', before, '--after', after], text => { output += text })
      assert.equal(JSON.parse(output).mode, 'private-adapter-health-trend')
      assert.equal(output.includes('www.plus.nl'), false)
      assert.equal(output.includes('www.dekamarkt.nl'), false)
      for (const row of (await loadReviewedRepositoryFixtures()).results) {
        for (const fact of row.observations) {
          assert.equal(output.includes(fact.name), false)
          assert.equal(output.includes(fact.provenance.sha256), false)
        }
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('CLI refuses symlinked files or unsafe argument shapes without stdout', async () => {
    const { report } = await baseline()
    const root = await mkdtemp(join(tmpdir(), 'supa-review-health-alias-'))
    try {
      const regular = join(root, 'original.json')
      const alias = join(root, 'alias.json')
      const next = join(root, 'next.json')
      await writeFile(regular, JSON.stringify(report), { mode: 0o600 })
      await writeFile(next, JSON.stringify(report), { mode: 0o600 })
      await symlink(regular, alias)
      let output = ''
      await assert.rejects(main(['--before', alias, '--after', next], t => { output += t }), /refused/)
      await assert.rejects(main(['--before', regular, '--after', regular], t => { output += t }), /refused/)
      await assert.rejects(main(['--publish'], t => { output += t }), /refused/)
      assert.equal(output, '')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
