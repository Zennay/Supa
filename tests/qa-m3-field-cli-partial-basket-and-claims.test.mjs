import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function run(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

async function syntheticAssessment(priceAdjustment, unavailableIndex = null) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-complete-cli-'))
  const sheetPath = join(directory, 'template.json')
  const studyPath = join(directory, 'study.json')
  const reportPath = join(directory, 'assessment.json')

  try {
    const generated = run(generator, '--output', sheetPath)
    assert.equal(generated.status, 0, generated.stderr)
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    sheet.study = {
      ...sheet.study,
      studyId: 'synthetic-qa-week',
      participantKey: 'fake-qa-only',
      population: 'synthetic testing only',
      region: 'synthetic region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    }

    for (const [side, store, hour] of [
      ['baseline', 'PLUS synthetic QA store', '10'],
      ['candidate', 'DekaMarkt synthetic QA store', '11'],
    ]) {
      const observation = sheet[side]
      observation.evidenceId = `${side}-synthetic-001`
      observation.observedAt = `2026-10-05T${hour}:00:00Z`
      observation.source = 'manual-cart'
      observation.provenanceNote = 'SYNTHETIC QA ONLY - no human observation'
      observation.store.id = `${side}-qa-store`
      observation.store.name = store
      observation.lines.forEach((line, index) => {
        const requirement = sheet.requirements[index]
        line.observedProduct = {
          productId: `${side}-${requirement.id}`,
          productName: requirement.query,
          packAmount: requirement.amount,
          packUnit: requirement.unit,
          packCount: 1,
          priceCents: 200 + index + (side === 'candidate' ? priceAdjustment : 0),
          available: !(side === 'candidate' && index === unavailableIndex),
          sourceUrl: '',
          note: 'synthetic unit test; not measured',
        }
      })
    }

    await writeFile(sheetPath, JSON.stringify(sheet), 'utf8')
    const converted = run(converter, sheetPath, '--output', studyPath)
    assert.equal(converted.status, 0, converted.stderr)
    const assessed = run(assessor, studyPath, '--output', reportPath)
    assert.equal(assessed.status, 0, assessed.stderr)
    return JSON.parse(await readFile(reportPath, 'utf8'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('one unavailable DekaMarkt line cannot be hidden by otherwise cheaper observed synthetic prices', async () => {
  const report = await syntheticAssessment(-10, 0)
  assert.equal(report.baseline.matchedLineCount, 11)
  assert.equal(report.candidate.matchedLineCount, 10)
  assert.equal(report.candidate.unresolvedLineCount, 1)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.savingsCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
})

test('fully matched synthetic cheaper basket is internal proof only, never an automatic public savings claim', async () => {
  const report = await syntheticAssessment(-10)
  assert.equal(report.baseline.matchedLineCount, 11)
  assert.equal(report.candidate.matchedLineCount, 11)
  assert.equal(report.outcome, 'better')
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.match(report.evidenceBoundary, /never sufficient/i)
})

test('fully matched synthetic more expensive basket preserves worse outcome and has no savings', async () => {
  const report = await syntheticAssessment(10)
  assert.equal(report.outcome, 'worse')
  assert.equal(report.claimable, true)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.savingsCents, 0)
})
