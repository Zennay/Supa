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

function run(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

// All values are synthetic controlled QA fixtures, never a real PLUS or DekaMarkt observation.
async function withSyntheticCompleteSheet(check) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-identity-clock-'))
  const sheetPath = join(directory, 'sheet.json')
  const studyPath = join(directory, 'study.json')
  const reportPath = join(directory, 'report.json')
  try {
    const generated = run(generator, '--output', sheetPath)
    assert.equal(generated.status, 0, generated.stderr)
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    sheet.study = {
      ...sheet.study,
      studyId: 'synthetic-identity-window',
      participantKey: 'synthetic-participant',
      population: 'controlled synthetic QA only',
      region: 'synthetic test region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    }

    for (const [side, store, observedAt] of [
      ['baseline', 'PLUS synthetic QA store', '2026-10-05T10:00:00Z'],
      ['candidate', 'DekaMarkt synthetic QA store', '2026-10-05T11:00:00Z'],
    ]) {
      sheet[side].evidenceId = `${side}-synthetic-identity-001`
      sheet[side].observedAt = observedAt
      sheet[side].source = 'manual-cart'
      sheet[side].provenanceNote = 'SYNTHETIC TEST FIXTURE, NOT COLLECTED IN A STORE'
      sheet[side].store.id = `${side}-synthetic-store`
      sheet[side].store.name = store
      sheet[side].lines.forEach((line, index) => {
        const requirement = sheet.requirements[index]
        line.observedProduct = {
          productId: `${side}-${requirement.id}`,
          productName: requirement.query,
          packAmount: requirement.amount,
          packUnit: requirement.unit,
          packCount: 1,
          priceCents: 200 + index + (side === 'candidate' ? -10 : 0),
          available: true,
          sourceUrl: '',
          note: 'synthetic numbers only; not observed',
        }
      })
    }
    await check({ sheet, sheetPath, studyPath, reportPath })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function convertAndAssess(sheet, sheetPath, studyPath, reportPath) {
  const serialized = JSON.stringify(sheet, null, 2) + '\n'
  await writeFile(sheetPath, serialized, 'utf8')
  const conversion = run(converter, sheetPath, '--output', studyPath)
  assert.equal(conversion.status, 0, conversion.stderr)
  const assessment = run(assessor, studyPath, '--output', reportPath)
  assert.equal(assessment.status, 0, assessment.stderr)
  assert.equal(await readFile(sheetPath, 'utf8'), serialized)
  return JSON.parse(await readFile(reportPath, 'utf8'))
}

function assertNoSavingsClaim(report, reason) {
  assert.equal(report.baseline.matchedLineCount, 11)
  assert.equal(report.candidate.matchedLineCount, 11)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.savingsCents, null)
  assert.equal(report.deltaCents, null)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.ok(report.reasons.some((value) => reason.test(value)), JSON.stringify(report.reasons))
}

test('M3 CLI preserves exact 24-hour boundary for otherwise valid synthetic same-demand baskets', async () => {
  await withSyntheticCompleteSheet(async ({ sheet, sheetPath, studyPath, reportPath }) => {
    sheet.candidate.observedAt = '2026-10-06T10:00:00Z'
    const report = await convertAndAssess(sheet, sheetPath, studyPath, reportPath)
    assert.equal(report.observationWindowHours, 24)
    assert.equal(report.claimable, true)
    assert.equal(report.outcome, 'better')
    assert.ok(report.savingsCents > 0)
    assert.equal(report.publicSavingsClaimEligible, false)
  })
})

test('M3 CLI rejects 24-hour-plus-1ms field times despite a fully matched cheaper synthetic candidate', async () => {
  await withSyntheticCompleteSheet(async ({ sheet, sheetPath, studyPath, reportPath }) => {
    sheet.candidate.observedAt = '2026-10-06T10:00:00.001Z'
    const report = await convertAndAssess(sheet, sheetPath, studyPath, reportPath)
    assert.ok(report.observationWindowHours > 24)
    assertNoSavingsClaim(report, /basket observations are .*apart/)
  })
})

test('M3 CLI rejects duplicate evidence IDs despite two distinct retailers and cheaper complete basket', async () => {
  await withSyntheticCompleteSheet(async ({ sheet, sheetPath, studyPath, reportPath }) => {
    sheet.candidate.evidenceId = sheet.baseline.evidenceId
    const report = await convertAndAssess(sheet, sheetPath, studyPath, reportPath)
    assertNoSavingsClaim(report, /evidence IDs must differ/i)
  })
})

test('M3 CLI rejects identical store IDs even when store names identify different retailers', async () => {
  await withSyntheticCompleteSheet(async ({ sheet, sheetPath, studyPath, reportPath }) => {
    sheet.candidate.store.id = sheet.baseline.store.id
    const report = await convertAndAssess(sheet, sheetPath, studyPath, reportPath)
    assertNoSavingsClaim(report, /stores must differ/i)
  })
})

test('M3 converter never emits a derived study when synthetic candidate store claims PLUS identity', async () => {
  await withSyntheticCompleteSheet(async ({ sheet, sheetPath, studyPath }) => {
    sheet.candidate.store.name = 'PLUS synthetic QA store'
    const serialized = JSON.stringify(sheet, null, 2) + '\n'
    await writeFile(sheetPath, serialized, 'utf8')
    const result = run(converter, sheetPath, '--output', studyPath)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /candidate\.store\.name must identify DekaMarkt/)
    assert.equal(result.stdout.trim(), '')
    assert.equal(existsSync(studyPath), false)
    assert.equal(await readFile(sheetPath, 'utf8'), serialized)
  })
})
