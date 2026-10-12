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

function observedSheet({ candidateAt, unavailable = false }) {
  const sheet = buildObservationSheet()
  assert.equal(sheet.requirements.length, 11)
  sheet.study = {
    ...sheet.study,
    studyId: 'synthetic-dst-2026-43',
    participantKey: PARTICIPANT,
    population: 'synthetic independent students',
    region: 'synthetic-region',
    weekStart: '2026-10-19',
    priceContext: 'in-store',
  }

  for (const [side, name, timestamp, premium] of [
    ['baseline', 'PLUS synthetic store', '2026-10-24T12:00:00+02:00', 10],
    ['candidate', 'DekaMarkt synthetic store', candidateAt, 0],
  ]) {
    const observation = sheet[side]
    observation.store = { id: `${side}-synthetic-store`, name }
    observation.evidenceId = `${side}-synthetic-evidence-001`
    observation.observedAt = timestamp
    observation.source = 'manual-cart'
    observation.provenanceNote = 'Fictional data; no visit or receipt.'
    for (const [index, line] of observation.lines.entries()) {
      const requirement = sheet.requirements[index]
      line.observedProduct = {
        productId: `${side}-product-${index}`,
        productName: requirement.query,
        packAmount: requirement.amount,
        packUnit: requirement.unit,
        packCount: 1,
        priceCents: 100 + index + premium,
        available: !(unavailable && side === 'candidate' && index === 0),
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

  assert.equal(study.baseline.basket.lines.length, 11)
  assert.equal(study.candidate.basket.lines.length, 11)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(reportText.includes(PARTICIPANT), false)
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
      assert.equal(report.claimable, scenario.claimable)
      assert.equal(report.outcome, scenario.outcome)
      assert.ok(Math.abs(report.observationWindowHours - scenario.window) < 1e-9)
      if (scenario.claimable) {
        assert.equal(report.baseline.matchedLineCount, 11)
        assert.equal(report.candidate.matchedLineCount, 11)
        assert.ok(report.savingsCents > 0)
      } else {
        assert.equal(report.savingsCents, null)
        assert.equal(report.deltaCents, null)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
