import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))
const privateNote = 'SYNTHETIC_PRIVATE_PROVENANCE_ONLY_NOT_FOR_REPORT'

function run(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

async function withSyntheticUnavailableFixture(check) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-provenance-'))
  const input = join(directory, 'sheet.json')
  const studyPath = join(directory, 'study.json')
  const reportPath = join(directory, 'report.json')
  try {
    const initial = run(generator, '--output', input)
    assert.equal(initial.status, 0, initial.stderr)
    const sheet = JSON.parse(await readFile(input, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'synthetic-provenance-validation',
      participantKey: 'fake-study-key',
      population: 'synthetic QA',
      region: 'synthetic region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })
    for (const [side, name, at] of [
      ['baseline', 'PLUS synthetic', '2026-10-05T12:00:00Z'],
      ['candidate', 'DekaMarkt synthetic', '2026-10-05T13:00:00Z'],
    ]) {
      sheet[side].evidenceId = `${side}-fake-proof-001`
      sheet[side].observedAt = at
      sheet[side].store = { id: `${side}-fake-store`, name }
      sheet[side].source = 'manual-cart'
      sheet[side].provenanceNote = privateNote
      sheet[side].lines.forEach((line) => {
        line.observedProduct.available = false
      })
    }
    await check({ sheet, input, studyPath, reportPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

for (const [baselineSource, candidateSource] of [
  ['manual-cart', 'receipt'],
  ['receipt', 'consented-export'],
  ['consented-export', 'manual-cart'],
]) {
  test(`allowed synthetic observed source pair ${baselineSource}/${candidateSource} survives CLI without leaking provenance or claiming savings`, async () => {
    await withSyntheticUnavailableFixture(async ({ sheet, input, studyPath, reportPath }) => {
      sheet.baseline.source = baselineSource
      sheet.candidate.source = candidateSource
      const submitted = JSON.stringify(sheet, null, 2) + '\n'
      await writeFile(input, submitted, 'utf8')
      const converted = run(converter, input, '--output', studyPath)
      assert.equal(converted.status, 0, converted.stderr)
      const study = JSON.parse(await readFile(studyPath, 'utf8'))
      assert.equal(study.baseline.source, baselineSource)
      assert.equal(study.candidate.source, candidateSource)
      assert.equal(study.baseline.provenanceNote, privateNote)

      const assessed = run(assessor, studyPath, '--output', reportPath)
      assert.equal(assessed.status, 0, assessed.stderr)
      const reportText = await readFile(reportPath, 'utf8')
      const report = JSON.parse(reportText)
      assert.equal(report.baseline.source, baselineSource)
      assert.equal(report.candidate.source, candidateSource)
      assert.equal(report.outcome, 'unknown')
      assert.equal(report.claimable, false)
      assert.equal(report.savingsCents, null)
      assert.equal(report.deltaCents, null)
      assert.equal(report.publicSavingsClaimEligible, false)
      assert.equal(reportText.includes(privateNote), false)
      assert.equal(reportText.includes(sheet.study.participantKey), false)
      assert.equal(await readFile(input, 'utf8'), submitted)
    })
  })
}

test('unapproved synthetic observation source is rejected before study output even with 11 explicit unavailabilities per store', async () => {
  await withSyntheticUnavailableFixture(async ({ sheet, input, studyPath }) => {
    sheet.candidate.source = 'scraped-without-consent'
    const original = JSON.stringify(sheet, null, 2) + '\n'
    await writeFile(input, original, 'utf8')
    const result = run(converter, input, '--output', studyPath)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /candidate\.source is not an allowed observed source/)
    assert.equal(result.stdout.trim(), '')
    assert.equal(existsSync(studyPath), false)
    assert.equal(await readFile(input, 'utf8'), original)
  })
})
