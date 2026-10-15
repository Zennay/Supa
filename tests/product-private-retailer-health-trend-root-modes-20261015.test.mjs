import assert from 'node:assert/strict'
import test from 'node:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { main } from '../scripts/retailer-private-adapter-health-trend.mjs'

// Physical 0600 reports from the real six archived adapter shapes; no HTTP,
// source publication, permission grant or public savings assertion.
async function stage(run) {
  const batch = await loadReviewedRepositoryFixtures()
  const latest = Math.max(...batch.results.flatMap(r =>
    r.observations.map(o => Date.parse(o.provenance.capturedAt))))
  const report = evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(latest + 3600000).toISOString(),
  })
  const root = await mkdtemp(join(tmpdir(), 'supa-private-health-root-'))
  const before = join(root, 'before.json')
  const after = join(root, 'after.json')
  try {
    await chmod(root, 0o700)
    for (const file of [before, after])
      await writeFile(file, JSON.stringify(report), { mode: 0o600, flag: 'wx' })
    return await run({ root, before, after })
  } finally { await rm(root, { recursive: true, force: true }) }
}
const options = ({ before, after }) => ['--before', before, '--after', after]
test('accept private six-shape 0700 directory and 0600 reports with no public claim', () =>
  stage(async files => {
    let output = ''
    const r = await main(options(files), data => { output += data })
    assert.equal(r.datasetRegressionSignalsDetected, false)
    assert.equal(r.permissionVerified, false)
    assert.equal(r.productionEnabled, false)
    assert.equal(r.publicSavingsClaimEligible, false)
    assert.equal(r.externalRequests, 0)
    assert.equal(JSON.parse(output).humanReviewRequired, true)
  }))
for (const mode of [0o750, 0o755, 0o730, 0o777, 0o701]) {
  test('refuse private health trend when report root is ' + mode.toString(8), () =>
    stage(async files => {
      await chmod(files.root, mode)
      let output = ''
      await assert.rejects(main(options(files), t => { output += t }),
        /Private retailer health trend refused/)
      assert.equal(output, '')
    }))
}
test('refuse either before or after report independently if its own parent becomes public', () =>
  stage(async files => {
    const separate = await mkdtemp(join(tmpdir(), 'supa-public-health-root-'))
    try {
      await chmod(separate, 0o755)
      const publicFile = join(separate, 'other.json')
      const batch = await loadReviewedRepositoryFixtures()
      const latest = Math.max(...batch.results.flatMap(r =>
        r.observations.map(o => Date.parse(o.provenance.capturedAt))))
      await writeFile(publicFile, JSON.stringify(evaluatePrivateAdapterHealth(batch, {
        referenceTime: new Date(latest + 3600000).toISOString(),
      })), { mode: 0o600, flag: 'wx' })
      for (const args of [
        ['--before', publicFile, '--after', files.after],
        ['--before', files.before, '--after', publicFile],
      ]) {
        let output = ''
        await assert.rejects(main(args, t => { output += t }),
          /Private retailer health trend refused/)
        assert.equal(output, '')
      }
    } finally { await rm(separate, { recursive: true, force: true }) }
  }))
