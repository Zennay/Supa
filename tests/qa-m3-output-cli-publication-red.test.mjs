import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

// Synthetic-only CLI coverage for #2039, stacked on #2038. These tests guard
// the *actual two M3 commands*, not only their shared filesystem helper.
const SECRET = 'PRIVATE_SYNTHETIC_QA_MARKER_NEVER_LOG'
function run(script, ...argv) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...argv], {
    encoding: 'utf8',
  })
}
function success(result) {
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '', 'explicit file output should have no stdout payload')
}
function noPrivateLogs(result) {
  assert.equal((result.stdout + result.stderr).includes(SECRET), false, 'private synthetic evidence marker must not enter logs')
}

async function withCanonicalSheet(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-cli-atomic-'))
  const input = join(dir, 'sheet.json')
  try {
    success(run(generator, '--output', input))
    const sheet = JSON.parse(await readFile(input, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'synthetic-publication-check',
      participantKey: 'synthetic-private-key',
      population: 'fictional QA',
      region: 'fictional QA region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })
    for (const [side, storeName, hour] of [
      ['baseline', 'PLUS fictional', '11'],
      ['candidate', 'DekaMarkt fictional', '12'],
    ]) {
      const basket = sheet[side]
      basket.evidenceId = `${side}-fictional-publish`
      basket.observedAt = `2026-10-05T${hour}:00:00Z`
      basket.source = 'manual-cart'
      basket.provenanceNote = SECRET
      basket.store = { id: `${side}-fake-store`, name: storeName }
      assert.equal(basket.lines.length, 11)
      for (const line of basket.lines) line.observedProduct.available = false
    }
    const sourceBytes = `${JSON.stringify(sheet, null, 2)}\n`
    await writeFile(input, sourceBytes)
    await callback({ dir, input, sourceBytes })
    assert.equal(await readFile(input, 'utf8'), sourceBytes)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('M3 converter CLI must refuse symlink publication into unrelated private output [expected RED]', async () => {
  await withCanonicalSheet(async ({ dir, input, sourceBytes }) => {
    const victim = join(dir, 'unrelated-private.json')
    const output = join(dir, 'study-output.json')
    const victimBytes = '{"mustRemain":"BYTE_IDENTICAL"}\n'
    await writeFile(victim, victimBytes)
    await symlink(victim, output)
    const response = run(converter, input, '--output', output)
    noPrivateLogs(response)
    assert.equal(await readFile(input, 'utf8'), sourceBytes)
    assert.equal(await readFile(victim, 'utf8'), victimBytes, 'converter followed symlink and modified unrelated file')
    assert.notEqual(response.status, 0, 'converter must reject output symlink')
  })
})

test('M3 assessor CLI must refuse symlink publication into unrelated private output [expected RED]', async () => {
  await withCanonicalSheet(async ({ dir, input }) => {
    const study = join(dir, 'valid-study.json')
    success(run(converter, input, '--output', study))
    const studyBytes = await readFile(study, 'utf8')
    const victim = join(dir, 'unrelated-private-report.json')
    const report = join(dir, 'report-output.json')
    const victimBytes = '{"mustRemain":"ORIGINAL_REPORT_BYTES"}\n'
    await writeFile(victim, victimBytes)
    await symlink(victim, report)
    const response = run(assessor, study, '--output', report)
    noPrivateLogs(response)
    assert.equal(await readFile(study, 'utf8'), studyBytes)
    assert.equal(await readFile(victim, 'utf8'), victimBytes, 'assessor followed symlink and modified unrelated report')
    assert.notEqual(response.status, 0, 'assessor must reject output symlink')
  })
})

test('M3 genuine CLI routes retain unknown/null and no public savings claim on canonical synthetic unavailable baskets [positive]', async () => {
  await withCanonicalSheet(async ({ dir, input }) => {
    const study = join(dir, 'valid-study.json')
    const report = join(dir, 'valid-report.json')
    const convertResult = run(converter, input, '--output', study)
    success(convertResult)
    noPrivateLogs(convertResult)
    const studyBytes = await readFile(study, 'utf8')
    const assessResult = run(assessor, study, '--output', report)
    success(assessResult)
    noPrivateLogs(assessResult)
    const observed = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(observed.outcome, 'unknown')
    assert.equal(observed.deltaCents, null)
    assert.equal(observed.savingsCents, null)
    assert.equal(observed.publicSavingsClaimEligible, false)
    assert.equal((await readFile(report, 'utf8')).includes(SECRET), false)
    assert.equal(await readFile(study, 'utf8'), studyBytes)
  })
})
