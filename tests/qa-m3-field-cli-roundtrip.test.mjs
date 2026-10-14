import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'

// Independent M3 operator smoke: exercise BOTH shipped CLI entrypoints, not just
// in-process domain functions. Every product, price and store below is fictional.
// This test is never evidence of observed retailer prices or a public saving.
function syntheticSheet({ unavailableCandidateIndex = -1 } = {}) {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'qa-m3-full-cli-roundtrip'
  sheet.study.participantKey = 'private-qa-participant-007'
  sheet.study.population = 'fictional students'
  sheet.study.region = 'fictional region'
  sheet.study.weekStart = '2026-09-28'
  sheet.study.priceContext = 'in-store'

  for (const [side, shop] of [
    ['baseline', { id: 'fictional-plus-a', name: 'PLUS fictitious store', extra: 10 }],
    ['candidate', { id: 'fictional-deka-b', name: 'DekaMarkt fictitious store', extra: 0 }],
  ]) {
    const observation = sheet[side]
    observation.evidenceId = `qa-${side}-001`
    observation.observedAt = side === 'baseline'
      ? '2026-10-02T12:00:00+02:00'
      : '2026-10-02T13:00:00+02:00'
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Entirely synthetic CLI QA; no real observation.'
    observation.store.id = shop.id
    observation.store.name = shop.name
    observation.lines.forEach((line, index) => {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${shop.id}-fictional-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + shop.extra,
        available: !(side === 'candidate' && index === unavailableCandidateIndex),
        sourceUrl: '',
        note: 'Synthetic QA value only',
      }
    })
  }
  return sheet
}

function cli(script, args) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types',
    script,
    ...args,
  ], { cwd: process.cwd(), encoding: 'utf8' })
}

async function roundTrip(sheet) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-cli-roundtrip-'))
  const sheetPath = join(directory, 'synthetic-sheet.json')
  const studyPath = join(directory, 'evidence', 'synthetic-study.json')
  const reportPath = join(directory, 'synthetic-report.json')
  try {
    await writeFile(sheetPath, JSON.stringify(sheet), 'utf8')
    const conversion = cli('scripts/m3-build-observed-study.mjs', [
      sheetPath, '--output', studyPath,
    ])
    assert.equal(conversion.status, 0, `converter: ${conversion.stderr}`)
    const study = JSON.parse(await readFile(studyPath, 'utf8'))
    const assessment = cli('scripts/m3-assess-observed-week.mjs', [
      studyPath, '--output', reportPath,
    ])
    assert.equal(assessment.status, 0, `assessor: ${assessment.stderr}`)
    const published = await readFile(reportPath, 'utf8')
    return { study, report: JSON.parse(published), published }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('M3 CLI chain: genuine-format fictional 11+11 demand stays private and cannot become public savings', async () => {
  const sheet = syntheticSheet()
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(sheet.requirements.length, 11)
  const { study, report, published } = await roundTrip(sheet)
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  assert.equal(study.baseline.basket.unresolvedLineCount, 0)
  assert.equal(study.candidate.basket.unresolvedLineCount, 0)
  assert.equal(study.priceContext, 'in-store')
  assert.equal(report.observationWindowHours, 1)
  assert.equal(report.claimable, true, 'internal fictional comparison is computable')
  assert.equal(report.outcome, 'better')
  assert.equal(report.savingsCents, 110, '11 items × 10 fictional cents difference')
  assert.equal(report.attribution.fullyAttributed, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
  assert.doesNotMatch(published, /private-qa-participant-007/)
  assert.doesNotMatch(published, /fictional-plus-a-fictional-0/)
  assert.match(report.evidenceBoundary, /never sufficient/)
})

test('M3 CLI chain: one genuinely unavailable-looking fictional item stays unknown without a money claim', async () => {
  const { study, report } = await roundTrip(
    syntheticSheet({ unavailableCandidateIndex: 5 }),
  )
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.candidate.basket.matchedLineCount, 10)
  assert.equal(study.candidate.basket.unresolvedLineCount, 1)
  assert.equal(report.claimable, false)
  assert.equal(report.outcome, 'unknown')
  assert.equal(report.deltaCents, null)
  assert.equal(report.savingsCents, null)
  assert.equal(report.attribution.fullyAttributed, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.match(report.reasons.join(' '), /unresolved ingredients/)
})

test('M3 CLI chain: untouched field template is refused and cannot create purported evidence', async () => {
  const sheet = buildObservationSheet()
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-unfilled-template-'))
  const input = join(directory, 'unfilled-collection-template.json')
  const output = join(directory, 'evidence', 'must-not-exist.json')
  try {
    await writeFile(input, JSON.stringify(sheet), 'utf8')
    const conversion = cli('scripts/m3-build-observed-study.mjs', [
      input, '--output', output,
    ])
    assert.notEqual(conversion.status, 0, 'an empty form cannot become observed evidence')
    await assert.rejects(readFile(output, 'utf8'), /ENOENT/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
