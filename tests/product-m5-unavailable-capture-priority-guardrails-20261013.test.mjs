import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

function snapshot(id, available) {
  return { id, supermarket: 'fictional-market', kind: 'product',
    success: available,
    ...(available ? {
      integrity: 'verified', manifestSha256: 'a'.repeat(64),
      html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
      schemaOrgProduct: { type: 'abstain' },
    } : {}),
  }
}
const inspected = (sources) => ({ sourceCount: sources.length, sources })
test('unavailable with no baseline must be P1, not forgeable as baseline_missing P2', () => {
  const report = compareInspections(inspected([snapshot('first', false)]))
  assert.equal(report.changes[0].status, 'unavailable')
  assert.equal(report.driftCount, 1)
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions[0].priority, 'P1')
  for (const falsifiedStatus of ['baseline_missing', 'added', 'unchanged']) {
    const forged = structuredClone(report)
    forged.changes[0].status = falsifiedStatus
    if (falsifiedStatus === 'baseline_missing') forged.driftCount = 0
    assert.throws(() => buildOfflineSelectorReviewQueue(forged),
      /Invalid offline capture comparison/)
  }
})
test('new failed source with a separate healthy baseline is P1 and count correct', () => {
  const now = [snapshot('new', false), snapshot('old', true)]
  const previous = [snapshot('old', true)]
  const result = compareInspections(inspected(now), inspected(previous))
  assert.deepEqual(result.changes.map(c => c.status),
    ['unavailable', 'unchanged'])
  assert.equal(result.driftCount, 1)
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.deepEqual(queue.actions.map(a => a.priority), ['P1', 'P3'])
  const forged = structuredClone(result)
  forged.changes[0].status = 'added'
  forged.driftCount = 1
  assert.throws(() => buildOfflineSelectorReviewQueue(forged),
    /Invalid offline capture comparison/)
})
test('real CLI translates synthetic unavailable first M1 capture to P1 without leaking IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-first-failed-'))
  try {
    const file = join(root, 'manifest.json')
    const raw = JSON.stringify({ milestone: 'M1 Data Feasibility',
      bounded: true, sourceCount: 1, results: [{
        id: 'private-fictional-source', supermarket: 'fictional',
        kind: 'product', success: false,
        requestedUrl: 'https://example.invalid/no-fetch',
        capturedAt: '2026-10-13T00:00:00.000Z',
      }] })
    await writeFile(file, raw, 'utf8')
    const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
    const executed = spawnSync(process.execPath, ['--experimental-strip-types', cli, root],
      { encoding: 'utf8', timeout: 10000 })
    assert.equal(executed.status, 0, executed.stderr)
    assert.equal(executed.stderr, '')
    const report = JSON.parse(executed.stdout)
    assert.equal(report.baselineProvided, false)
    assert.equal(report.driftCount, 1)
    assert.deepEqual(report.actions.map(a => [a.status, a.priority, a.action]),
      [['unavailable', 'P1', 'recapture_or_investigate_failure']])
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
    assert.equal(report.rightsVerified, false)
    assert.doesNotMatch(executed.stdout, /private-fictional|example.invalid|fictional/)
    assert.equal(await readFile(file, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
