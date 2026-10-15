import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { main } from '../scripts/retailer-private-adapter-health-trend.mjs'

const runner = new URL('../scripts/retailer-private-adapter-health-trend.mjs', import.meta.url).pathname
async function withReports(fn) {
  const batch = await loadReviewedRepositoryFixtures()
  const latest = Math.max(...batch.results.flatMap(row =>
    row.observations.map(obs => Date.parse(obs.provenance.capturedAt))))
  const report = evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(latest + 3600000).toISOString(),
  })
  const dir = await mkdtemp(join(tmpdir(), 'supa-product-health-json-'))
  const before = join(dir, 'before.json')
  const after = join(dir, 'after.json')
  try {
    await chmod(dir, 0o700)
    await writeFile(before, JSON.stringify(report), { flag: 'wx', mode: 0o600 })
    await writeFile(after, JSON.stringify(report), { flag: 'wx', mode: 0o600 })
    await fn({ before, after, report, dir })
  } finally { await rm(dir, { force: true, recursive: true }) }
}
async function refuseBeforeAndAfter(mutate) {
  await withReports(async ({ before, after, dir }) => {
    const raw = await readFile(before, 'utf8')
    const modified = mutate(raw)
    assert.notEqual(modified, raw)
    assert.deepEqual(JSON.parse(modified), JSON.parse(raw),
      'last-wins decoder accepts the original semantics but raw bytes are ambiguous')
    for (const file of [before, after]) {
      await writeFile(file, modified, { mode: 0o600 })
      let output = ''
      await assert.rejects(main(['--before', before, '--after', after], s => {
        output += s
      }), /Private retailer health trend refused/)
      assert.equal(output, '')
      await writeFile(file, raw, { mode: 0o600 })
    }
    // CLI must never print a private path, evidence or a successful report.
    await writeFile(after, modified, { mode: 0o600 })
    const cli = spawnSync(process.execPath,
      ['--experimental-strip-types', runner, '--before', before, '--after', after],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
    assert.equal(cli.status, 2)
    assert.equal(cli.stdout, '')
    assert.match(cli.stderr, /^Private retailer health trend refused\s*$/)
    assert.equal(cli.stderr.includes(dir), false)
  })
}

test('canonical historical six-shape reports remain accepted as private, without regression', () =>
  withReports(async ({ before, after }) => {
    let out = ''
    const trend = await main(['--before', before, '--after', after], s => {
      out += s
    })
    assert.equal(trend.datasetRegressionSignalsDetected, false)
    assert.deepEqual(trend.reviewSignals, [])
    assert.equal(trend.productionEnabled, false)
    assert.equal(trend.permissionVerified, false)
    assert.equal(trend.publicSavingsClaimEligible, false)
    assert.equal(trend.externalRequests, 0)
    assert.equal(JSON.parse(out).mode, 'private-adapter-health-trend')
  }))

test('reject duplicate permission claim in either historical private JSON report', () =>
  refuseBeforeAndAfter(raw => raw.replace('"permissionVerified":false',
    '"permissionVerified":true,"permissionVerified":false')))

test('reject duplicate root observation count in before and after files', () =>
  refuseBeforeAndAfter(raw => raw.replace('"observations":',
    '"observations":999,"observations":')))

test('reject duplicate nested accepted source bucket count', () =>
  refuseBeforeAndAfter(raw => raw.replace('"accepted":',
    '"accepted":999,"accepted":')))

test('reject equivalent property name using JSON Unicode escape', () =>
  refuseBeforeAndAfter(raw => raw.replace('"permissionVerified":false',
    '"permission\\u0056erified":true,"permissionVerified":false')))

test('reject duplicate nested retailer shape with last-wins original content', () =>
  refuseBeforeAndAfter(raw => {
    const section = '"plus:product":'
    assert.ok(raw.includes(section))
    return raw.replace(section, '"plus:product":null,' + section)
  }))
