import assert from 'node:assert/strict'
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

function fillSide(sheet, side, { storeId, storeName, priceOffset = 0 }) {
  const observation = sheet[side]
  observation.evidenceId = `${side}-week-001`
  observation.observedAt =
    side === 'baseline' ? '2026-10-04T12:00:00Z' : '2026-10-04T13:00:00Z'
  observation.source = 'manual-cart'
  observation.provenanceNote = 'Synthetic regression observation only.'
  observation.store.id = storeId
  observation.store.name = storeName

  observation.lines.forEach((line, index) => {
    const requirement = sheet.requirements[index]
    line.observedProduct = {
      productId: `${storeId}-${requirement.id}`,
      productName: requirement.query,
      packAmount: requirement.amount,
      packUnit: requirement.unit,
      packCount: 1,
      priceCents: 100 + index + priceOffset,
      available: true,
      sourceUrl: '',
      note: 'Synthetic regression value.',
    }
  })
}

function completedSheet() {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'week-2026-40-converter'
  sheet.study.participantKey = 'student-003'
  sheet.study.population = 'independently living students'
  sheet.study.region = 'test-region'
  sheet.study.weekStart = '2026-09-28'
  sheet.study.priceContext = 'in-store'
  fillSide(sheet, 'baseline', {
    storeId: 'plus-leiden-test',
    storeName: 'PLUS Leiden testfiliaal',
    priceOffset: 10,
  })
  fillSide(sheet, 'candidate', {
    storeId: 'dekamarkt-leiden-test',
    storeName: 'DekaMarkt Leiden testfiliaal',
    priceOffset: 0,
  })
  return sheet
}

test('M3 observation sheet converts into a structurally valid claimable weekly study', () => {
  const study = buildWeeklyBasketStudyFromObservationSheet(completedSheet())
  const assessment = assessWeeklyBasketStudy(study)

  assert.equal(study.priceContext, 'in-store')
  assert.equal(study.baseline.basket.matchedLineCount, 11)
  assert.equal(study.baseline.basket.unresolvedLineCount, 0)
  assert.equal(study.candidate.basket.matchedLineCount, 11)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
  assert.equal(assessment.observationWindowHours, 1)
})

test('M3 converter preserves an observed unavailable product as unknown evidence', () => {
  const sheet = completedSheet()
  sheet.candidate.lines[0].observedProduct.available = false

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = assessWeeklyBasketStudy(study)

  assert.equal(study.candidate.basket.unresolvedLineCount, 1)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.match(assessment.reasons.join(' '), /unresolved ingredients/)
})

test('M3 converter preserves a missing observed price as unresolved instead of inventing money', () => {
  const sheet = completedSheet()
  sheet.baseline.lines[1].observedProduct.priceCents = null

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const line = study.baseline.basket.lines.find(
    (candidate) => candidate.id === sheet.requirements[1].id,
  )

  assert.equal(line.status, 'unresolved')
  assert.match(line.reasons.join(' '), /price is unknown/i)
})

test('M3 converter preserves missing pack counts as unresolved evidence', () => {
  for (const packCount of [undefined, null]) {
    const sheet = completedSheet()
    if (packCount === undefined) {
      delete sheet.baseline.lines[0].observedProduct.packCount
    } else {
      sheet.baseline.lines[0].observedProduct.packCount = packCount
    }

    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const assessment = assessWeeklyBasketStudy(study)
    const line = study.baseline.basket.lines[0]

    assert.equal(line.status, 'unresolved')
    assert.match(line.reasons.join(' '), /pack count is unknown or invalid/i)
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.outcome, 'unknown')
  }
})

test('M3 converter preserves unsafe cent values as unresolved evidence', () => {
  const sheet = completedSheet()
  sheet.baseline.lines[1].observedProduct.priceCents = Number.MAX_SAFE_INTEGER + 1

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const line = study.baseline.basket.lines.find(
    (candidate) => candidate.id === sheet.requirements[1].id,
  )

  assert.equal(line.status, 'unresolved')
  assert.match(line.reasons.join(' '), /price is unknown or invalid/i)
})

test('M3 converter rejects invalid or underspecified observation timestamps before building study evidence', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const observedAt of [
      'not-a-timestamp',
      '2026-10-04',
      '2026-02-31T12:00:00Z',
      '2026-10-04T12:00:00+24:00',
    ]) {
      const sheet = completedSheet()
      sheet[side].observedAt = observedAt

      assert.throws(
        () => buildWeeklyBasketStudyFromObservationSheet(sheet),
        new RegExp(`${side}\\.observedAt must be a valid timestamp`),
      )
    }
  }
})

test('M3 converter rejects impossible study week dates', () => {
  const sheet = completedSheet()
  sheet.study.weekStart = '2026-02-31'

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /sheet\.study\.weekStart must be a valid YYYY-MM-DD date/,
  )
})

test('M3 converter refuses retailer drift from the canonical PLUS + DekaMarkt pair', () => {
  const wrongBaseline = completedSheet()
  wrongBaseline.baseline.store.name = 'Andere supermarkt'

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(wrongBaseline),
    /baseline\.store\.name must identify PLUS/,
  )

  const wrongCandidate = completedSheet()
  wrongCandidate.candidate.store.name = 'PLUS tweede filiaal'

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(wrongCandidate),
    /candidate\.store\.name must identify DekaMarkt/,
  )
})

test('M3 converter rejects reused evidence identity across retailer observations', () => {
  const sheet = completedSheet()
  sheet.candidate.evidenceId = sheet.baseline.evidenceId

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /baseline and candidate evidence IDs must differ/,
  )
})

test('M3 converter rejects a shared store identity across retailer observations', () => {
  const sheet = completedSheet()
  sheet.candidate.store.id = sheet.baseline.store.id

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /baseline and candidate stores must differ/,
  )
})

test('M3 converter preserves out-of-window observations as downstream unknown evidence', () => {
  const sheet = completedSheet()
  sheet.baseline.observedAt = '2026-10-04T12:00:00Z'
  sheet.candidate.observedAt = '2026-10-05T12:00:01Z'

  const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
  const assessment = assessWeeklyBasketStudy(study)

  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.match(assessment.reasons.join(' '), /max is 24h/)
})

test('M3 converter refuses a missing price context', () => {
  const sheet = completedSheet()
  sheet.study.priceContext = ''

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /priceContext must be in-store or online-order/,
  )
})

test('M3 converter refuses planner-demand drift', () => {
  const sheet = completedSheet()
  sheet.requirements[0].amount += 1

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /requirements must exactly match the canonical planner demand/,
  )
})

test('M3 converter refuses ambiguous availability types', () => {
  const sheet = completedSheet()
  sheet.baseline.lines[0].observedProduct.available = 'yes'

  assert.throws(
    () => buildWeeklyBasketStudyFromObservationSheet(sheet),
    /available must be true or false/,
  )
})

test('M3 converter CLI rejects missing, option-like, and duplicate output paths', () => {
  const cases = [
    ['unused-observation-sheet.json', '--output'],
    ['unused-observation-sheet.json', '--output', '--bogus'],
    [
      'unused-observation-sheet.json',
      '--output',
      'first-study.json',
      '--output',
      'second-study.json',
    ],
  ]

  for (const args of cases) {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-build-observed-study.mjs', ...args],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /--output (?:requires a file path|may only be provided once)/,
    )
  }
})

test('M3 converter CLI refuses a hardlink alias that targets the raw observation sheet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-hardlink-'))
  const input = join(directory, 'observation-sheet.json')
  const output = join(directory, 'study-hardlink.json')
  const original = `${JSON.stringify(completedSheet(), null, 2)}\n`

  try {
    await writeFile(input, original, 'utf8')
    await link(input, output)

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /--output must not overwrite the observation sheet input/,
    )
    assert.equal(await readFile(input, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 converter CLI refuses a symlink alias that targets the raw observation sheet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-symlink-'))
  const input = join(directory, 'observation-sheet.json')
  const output = join(directory, 'study-alias.json')
  const original = `${JSON.stringify(completedSheet(), null, 2)}\n`

  try {
    await writeFile(input, original, 'utf8')
    await symlink(input, output)

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /--output must not overwrite the observation sheet input/,
    )
    assert.equal(await readFile(input, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 converter CLI refuses to overwrite the raw observation sheet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-source-'))
  const input = join(directory, 'observation-sheet.json')
  const original = `${JSON.stringify(completedSheet(), null, 2)}\n`

  try {
    await writeFile(input, original, 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        input,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /--output must not overwrite the observation sheet input/,
    )
    assert.equal(await readFile(input, 'utf8'), original)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 converter CLI preserves an existing study output instead of overwriting it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-existing-'))
  const input = join(directory, 'observation-sheet.json')
  const output = join(directory, 'study.json')
  const originalInput = `${JSON.stringify(completedSheet(), null, 2)}\n`
  const originalOutput = '{"existing":"evidence"}\n'

  try {
    await writeFile(input, originalInput, 'utf8')
    await writeFile(output, originalOutput, 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.notEqual(result.status, 0)
    assert.match(
      result.stderr,
      /--output already exists; refusing to overwrite existing study evidence/,
    )
    assert.equal(await readFile(input, 'utf8'), originalInput)
    assert.equal(await readFile(output, 'utf8'), originalOutput)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('M3 converter CLI writes a nested WeeklyBasketStudy output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-study-'))
  const input = join(directory, 'observation-sheet.json')
  const output = join(directory, 'evidence', 'm3', 'study.json')

  try {
    await writeFile(input, JSON.stringify(completedSheet(), null, 2), 'utf8')

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-build-observed-study.mjs',
        input,
        '--output',
        output,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    assert.equal(result.status, 0, result.stderr)
    const study = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(study.schemaVersion, 1)
    assert.equal(study.studyId, 'week-2026-40-converter')
    assert.equal(study.baseline.basket.matchedLineCount, 11)
    assert.equal(study.candidate.basket.matchedLineCount, 11)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
