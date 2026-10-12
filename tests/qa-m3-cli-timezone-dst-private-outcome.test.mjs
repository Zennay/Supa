import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'

// Synthetic-only CLI contract. Neither source prices nor field observations are used.
const ZONES = ['UTC', 'Europe/Amsterdam', 'America/New_York']
const PARTICIPANT = 'synthetic-participant-privacy-marker-001'
const PRIVATE_PROVENANCE_MARKER = 'fictional-private-provenance-marker-do-not-emit'

function observedSheet({
  baselineAt,
  candidateAt,
  weekStart,
  unavailable = false,
  baselineUnavailable = false,
  priceContext = 'in-store',
  candidatePremium = 0,
}) {
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  sheet.study = {
    ...sheet.study,
    studyId: 'synthetic-dst-2026-43',
    participantKey: PARTICIPANT,
    population: 'synthetic independent students',
    region: 'synthetic-region',
    weekStart: weekStart ?? '2026-10-19',
    priceContext,
  }

  for (const [side, name, timestamp, premium] of [
    ['baseline', 'PLUS synthetic store', baselineAt ?? '2026-10-24T12:00:00+02:00', 10],
    ['candidate', 'DekaMarkt synthetic store', candidateAt, candidatePremium],
  ]) {
    const observation = sheet[side]
    observation.store = { id: `${side}-synthetic-store`, name }
    observation.evidenceId = `${side}-synthetic-evidence-001`
    observation.observedAt = timestamp
    observation.source = 'manual-cart'
    observation.provenanceNote = `${side}-${PRIVATE_PROVENANCE_MARKER}`
    for (const [index, line] of observation.lines.entries()) {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${side}-product-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + premium,
        available: !((unavailable && side === 'candidate' && index === 0) ||
          (baselineUnavailable && side === 'baseline' && index === 0)),
        sourceUrl: '',
        note: 'Synthetic-only regression value.',
      }
    }
  }
  return sheet
}

function cli(script, input, tz) {
  const run = spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, TZ: tz },
      timeout: 30_000,
    },
  )
  assert.equal(run.status, 0, `${script} failed under TZ=${tz}: ${run.stderr}`)
  assert.equal(run.stderr, '', `unexpected stderr under TZ=${tz}`)
  return run.stdout
}

async function runThroughBothClis(sheet, timezone, directory) {
  const input = join(directory, 'synthetic-observation.json')
  const studyFile = join(directory, 'synthetic-study.json')
  await writeFile(input, JSON.stringify(sheet), 'utf8')
  const studyText = cli('scripts/m3-build-observed-study.mjs', input, timezone)
  await writeFile(studyFile, studyText, 'utf8')
  const reportText = cli('scripts/m3-assess-observed-week.mjs', studyFile, timezone)
  const study = JSON.parse(studyText)
  const report = JSON.parse(reportText)

  assert.equal(study.participantKey, PARTICIPANT)
  assert.equal(study.baseline.basket.lines.length, 11)
  assert.equal(study.candidate.basket.lines.length, 11)
  for (const side of ['baseline', 'candidate']) {
    const inputSide = sheet[side]
    const studySide = study[side]
    const reportSide = report[side]
    assert.equal(studySide.evidenceId, inputSide.evidenceId)
    assert.equal(studySide.observedAt, inputSide.observedAt)
    assert.equal(studySide.provenanceNote, inputSide.provenanceNote)
    assert.equal(studySide.source, inputSide.source)
    assert.deepEqual(studySide.basket.store, inputSide.store)
    assert.equal(reportSide.evidenceId, inputSide.evidenceId)
    assert.equal(reportSide.observedAt, inputSide.observedAt)
    assert.equal(reportSide.source, inputSide.source)
    assert.equal(reportSide.storeId, inputSide.store.id)
    assert.equal(reportSide.storeName, inputSide.store.name)
    assert.equal(reportSide.matchedLineCount + reportSide.unresolvedLineCount, 11)
    assert.equal(Object.hasOwn(reportSide, 'provenanceNote'), false)
    for (const [index, row] of studySide.basket.lines.entries()) {
      const requirement = sheet.requirements[index]
      assert.equal(row.id, requirement.id)
      assert.equal(row.ingredientLabel, requirement.label)
      assert.deepEqual(row.requirement, {
        amount: requirement.amount,
        unit: requirement.unit,
      })
    }
  }
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(reportText.includes(PARTICIPANT), false)
  assert.equal(reportText.includes(PRIVATE_PROVENANCE_MARKER), false)
  return { studyText, reportText, report }
}

for (const scenario of [
  {
    name: 'DST fall-back, exactly 24 hours',
    candidateAt: '2026-10-25T11:00:00+01:00',
    unavailable: false,
    claimable: true,
    outcome: 'better',
    window: 24,
  },
  {
    name: 'DST fall-back, over 24 hours by one second',
    candidateAt: '2026-10-25T11:00:01+01:00',
    unavailable: false,
    claimable: false,
    outcome: 'unknown',
    window: 24 + 1 / 3600,
  },
  {
    name: 'DST spring-forward, exactly 24 absolute hours',
    baselineAt: '2026-03-28T12:00:00+01:00',
    candidateAt: '2026-03-29T13:00:00+02:00',
    weekStart: '2026-03-23',
    unavailable: false,
    claimable: true,
    outcome: 'better',
    window: 24,
  },
  {
    name: 'DST spring-forward, over 24 absolute hours by one second',
    baselineAt: '2026-03-28T12:00:00+01:00',
    candidateAt: '2026-03-29T13:00:01+02:00',
    weekStart: '2026-03-23',
    unavailable: false,
    claimable: false,
    outcome: 'unknown',
    window: 24 + 1 / 3600,
  },
  {
    name: 'DST fall-back, online-order candidate is more expensive',
    candidateAt: '2026-10-25T11:00:00+01:00',
    priceContext: 'online-order',
    candidatePremium: 25,
    unavailable: false,
    claimable: true,
    outcome: 'worse',
    window: 24,
  },
  {
    name: 'DST fall-back, candidate observed before baseline exactly 24h',
    baselineAt: '2026-10-25T11:00:00+01:00',
    candidateAt: '2026-10-24T12:00:00+02:00',
    claimable: true,
    outcome: 'better',
    window: 24,
  },
  {
    name: 'DST fall-back, equal baskets retain same outcome',
    candidateAt: '2026-10-25T11:00:00+01:00',
    candidatePremium: 10,
    claimable: true,
    outcome: 'same',
    window: 24,
  },
  {
    name: 'two UTC offset representations of one instant have a zero-hour window',
    candidateAt: '2026-10-24T11:00:00+01:00',
    claimable: true,
    outcome: 'better',
    window: 0,
  },
  {
    name: 'DST spring-forward 1ms inside the inclusive 24-hour bound',
    baselineAt: '2026-03-28T12:00:00+01:00',
    candidateAt: '2026-03-29T12:59:59.999+02:00',
    weekStart: '2026-03-23',
    claimable: true,
    outcome: 'better',
    window: 24 - 1 / 3600000,
  },
  {
    name: 'DST fall-back, baseline item unavailable prevents financial claim',
    candidateAt: '2026-10-25T11:00:00+01:00',
    baselineUnavailable: true,
    claimable: false,
    outcome: 'unknown',
    window: 24,
  },
  {
    name: 'DST fall-back, unresolved candidate item',
    candidateAt: '2026-10-25T11:00:00+01:00',
    unavailable: true,
    claimable: false,
    outcome: 'unknown',
    window: 24,
  },
]) {
  test(`M3 CLI timezone-independent private outcome: ${scenario.name}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'supa-qa-m3-dst-'))
    try {
      const sheet = observedSheet(scenario)
      const results = []
      for (const timezone of ZONES) {
        results.push(await runThroughBothClis(sheet, timezone, directory))
      }
      assert.equal(new Set(results.map((result) => result.studyText)).size, 1)
      assert.equal(new Set(results.map((result) => result.reportText)).size, 1)
      const { report } = results[0]
      assert.equal(report.priceContext, scenario.priceContext ?? 'in-store')
      assert.equal(report.claimable, scenario.claimable)
      assert.equal(report.outcome, scenario.outcome)
      assert.ok(Math.abs(report.observationWindowHours - scenario.window) < 1e-9)
      if (scenario.claimable) {
        assert.equal(report.baseline.matchedLineCount, 11)
        assert.equal(report.candidate.matchedLineCount, 11)
        if (scenario.outcome === 'better') assert.ok(report.savingsCents > 0)
        if (scenario.outcome === 'worse') assert.ok(report.savingsCents < 0)
        if (scenario.outcome === 'same') {
          assert.equal(report.savingsCents, 0)
          assert.equal(report.deltaCents, 0)
        }
      } else {
        assert.equal(report.savingsCents, null)
        assert.equal(report.deltaCents, null)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
