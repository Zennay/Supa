import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function run(script, ...args) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), '', 'explicit file output must not leak evidence via stdout')
}

test('M3 distinct existing derived outputs can be safely regenerated; originals and private markers survive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-rerun-'))
  const sheetPath = join(dir, 'sheet.json')
  const studyPath = join(dir, 'study.json')
  const reportPath = join(dir, 'report.json')
  try {
    run(generator, '--output', sheetPath)
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'synthetic-rerun-only',
      participantKey: 'private-synthetic-marker',
      population: 'fictional QA sample',
      region: 'fictional-region-alpha',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })
    for (const [side, name, time] of [
      ['baseline', 'PLUS fictional', '2026-10-05T11:00:00Z'],
      ['candidate', 'DekaMarkt fictional', '2026-10-05T12:00:00Z'],
    ]) {
      const observation = sheet[side]
      observation.evidenceId = `${side}-fictional-rerun`
      observation.observedAt = time
      observation.source = 'manual-cart'
      observation.provenanceNote = 'PRIVATE_SYNTHETIC_SOURCE_ONLY'
      observation.store = { id: `${side}-fictional-store`, name }
      for (const line of observation.lines) line.observedProduct.available = false
    }
    await writeFile(sheetPath, `${JSON.stringify(sheet, null, 2)}\n`)

    run(converter, sheetPath, '--output', studyPath)
    const firstStudy = JSON.parse(await readFile(studyPath, 'utf8'))
    assert.equal(firstStudy.region, 'fictional-region-alpha')

    sheet.study.region = 'fictional-region-beta'
    const updatedSheet = `${JSON.stringify(sheet, null, 2)}\n`
    await writeFile(sheetPath, updatedSheet)
    run(converter, sheetPath, '--output', studyPath)
    const studyBytes = await readFile(studyPath, 'utf8')
    const secondStudy = JSON.parse(studyBytes)
    assert.equal(secondStudy.region, 'fictional-region-beta', 'existing distinct study should be updated')
    assert.equal(await readFile(sheetPath, 'utf8'), updatedSheet)

    run(assessor, studyPath, '--output', reportPath)
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).region, 'fictional-region-beta')

    secondStudy.region = 'fictional-region-gamma'
    const updatedStudy = `${JSON.stringify(secondStudy, null, 2)}\n`
    await writeFile(studyPath, updatedStudy)
    run(assessor, studyPath, '--output', reportPath)
    const reportBytes = await readFile(reportPath, 'utf8')
    const finalReport = JSON.parse(reportBytes)
    assert.equal(finalReport.region, 'fictional-region-gamma', 'existing distinct report should update')
    assert.equal(finalReport.claimable, false)
    assert.equal(finalReport.outcome, 'unknown')
    assert.equal(finalReport.deltaCents, null)
    assert.equal(finalReport.savingsCents, null)
    assert.equal(finalReport.publicSavingsClaimEligible, false)
    assert.equal(reportBytes.includes('private-synthetic-marker'), false)
    assert.equal(reportBytes.includes('PRIVATE_SYNTHETIC_SOURCE_ONLY'), false)
    assert.equal(await readFile(studyPath, 'utf8'), updatedStudy)
    assert.equal(await readFile(sheetPath, 'utf8'), updatedSheet)

    // Fresh derived artifacts are private by default on the Linux CI runner.
    assert.equal((await stat(studyPath)).mode & 0o777, 0o600)
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
