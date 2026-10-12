import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

// Synthetic prices in this test are arbitrary, never measured at PLUS or DekaMarkt.
async function syntheticTwoStorePrices(candidateCents) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-same-value-'))
  const input = join(directory, 'sheet.json')
  const studyPath = join(directory, 'study.json')
  const reportPath = join(directory, 'report.json')
  try {
    const generated = run(generator, '--output', input)
    assert.equal(generated.status, 0, generated.stderr)
    const sheet = JSON.parse(await readFile(input, 'utf8'))
    assert.equal(sheet.requirements.length, 11)

    Object.assign(sheet.study, {
      studyId: 'synthetic-same-value-study',
      participantKey: 'synthetic-participant',
      population: 'synthetic students',
      region: 'synthetic region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })

    for (const [side, name, at] of [
      ['baseline', 'PLUS synthetic test store', '2026-10-05T10:00:00Z'],
      ['candidate', 'DekaMarkt synthetic test store', '2026-10-05T11:00:00Z'],
    ]) {
      sheet[side].evidenceId = `${side}-fake-value-001`
      sheet[side].observedAt = at
      sheet[side].source = 'manual-cart'
      sheet[side].provenanceNote = 'SYNTHETIC; NOT ACTUAL SUPERMARKET EVIDENCE'
      sheet[side].store = { id: `${side}-fake-store`, name }
      sheet[side].lines.forEach((line, index) => {
        const requirement = sheet.requirements[index]
        line.observedProduct = {
          productId: `${side}-fake-${requirement.id}`,
          productName: requirement.query,
          packAmount: requirement.amount,
          packUnit: requirement.unit,
          packCount: 1,
          priceCents: side === 'baseline' ? 200 + index : candidateCents(index),
          available: true,
          sourceUrl: '',
          note: 'synthetic only',
        }
      })
    }

    await writeFile(input, JSON.stringify(sheet), 'utf8')
    const converted = run(converter, input, '--output', studyPath)
    assert.equal(converted.status, 0, converted.stderr)
    const assessed = run(assessor, studyPath, '--output', reportPath)
    assert.equal(assessed.status, 0, assessed.stderr)
    const study = JSON.parse(await readFile(studyPath, 'utf8'))
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    assert.equal(study.baseline.basket.lines.length, 11)
    assert.equal(study.candidate.basket.lines.length, 11)
    assert.equal(report.baseline.matchedLineCount, 11)
    assert.equal(report.candidate.matchedLineCount, 11)
    return report
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('equal synthetic full-basket totals stay SAME with exact zero savings and no public monetary claim', async () => {
  const result = await syntheticTwoStorePrices((index) => 200 + index)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.baselineTotalCents, result.candidateTotalCents)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('zero-priced synthetic candidate is not mistaken for unavailable or an authorized public savings claim', async () => {
  const result = await syntheticTwoStorePrices(() => 0)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'better')
  assert.equal(result.candidateTotalCents, 0)
  assert.ok(result.baselineTotalCents > 0)
  assert.ok(result.savingsCents > 0)
  assert.equal(result.publicSavingsClaimEligible, false)
})
