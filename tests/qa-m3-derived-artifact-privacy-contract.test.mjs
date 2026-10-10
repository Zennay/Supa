import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildObservationSheet } from '../scripts/m3-create-observation-sheet.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'

// All values here are synthetic fixtures: never treat them as retailer observations.
function syntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-artifact-qa',
    participantKey: 'synthetic-participant-001',
    population: 'test-only population',
    region: 'test-only region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })

  for (const [side, name, id, offset] of [
    ['baseline', 'PLUS synthetic fixture', 'synthetic-plus', 20],
    ['candidate', 'DekaMarkt synthetic fixture', 'synthetic-deka', 0],
  ]) {
    const evidence = sheet[side]
    evidence.evidenceId = `${side}-synthetic-001`
    evidence.observedAt = side === 'baseline'
      ? '2026-10-07T12:00:00Z'
      : '2026-10-07T13:00:00Z'
    evidence.source = 'manual-cart'
    evidence.provenanceNote = 'SYNTHETIC QA ONLY; not a retailer observation'
    evidence.store.id = id
    evidence.store.name = name

    evidence.lines.forEach((line, index) => {
      const demand = sheet.requirements[index]
      line.observedProduct = {
        available: true,
        productId: `${id}-${demand.id}`,
        productName: demand.query,
        packAmount: demand.amount,
        packUnit: demand.unit,
        packCount: 1,
        priceCents: 100 + offset + index,
        sourceUrl: '',
        note: 'Synthetic QA fixture only',
      }
    })
  }

  return sheet
}

function runCli(script, input, output) {
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', script, input, '--output', output],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
}

async function inScratch(label, run) {
  const root = await mkdtemp(join(tmpdir(), `supa-${label}-`))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('M3 converter refuses to replace an existing derived study, byte-for-byte', async () => {
  await inScratch('study-no-clobber', async (root) => {
    const input = join(root, 'source.json')
    const output = join(root, 'reviewed-study.json')
    const sentinel = 'previous approved review output — keep me unchanged\n'
    await writeFile(input, JSON.stringify(syntheticSheet()))
    await writeFile(output, sentinel)

    const result = runCli('scripts/m3-build-observed-study.mjs', input, output)
    assert.notEqual(result.status, 0, 'converter must fail if output already exists')
    assert.equal(result.stdout, '', 'failed output creation must not print study data')
    assert.equal(await readFile(output, 'utf8'), sentinel)
  })
})

test('M3 converter writes genuinely new derived study with owner-only permissions', {
  skip: process.platform === 'win32',
}, async () => {
  await inScratch('study-private', async (root) => {
    const input = join(root, 'source.json')
    const output = join(root, 'new-study.json')
    await writeFile(input, JSON.stringify(syntheticSheet()))

    const result = runCli('scripts/m3-build-observed-study.mjs', input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).schemaVersion, 1)
  })
})

test('M3 assessment refuses to replace an existing report, byte-for-byte', async () => {
  await inScratch('report-no-clobber', async (root) => {
    const input = join(root, 'derived-study.json')
    const output = join(root, 'reviewed-report.json')
    const sentinel = 'previous reviewed assessment — keep me unchanged\n'
    const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
    await writeFile(input, JSON.stringify(study))
    await writeFile(output, sentinel)

    const result = runCli('scripts/m3-assess-observed-week.mjs', input, output)
    assert.notEqual(result.status, 0, 'assessment must fail if output already exists')
    assert.equal(result.stdout, '', 'failed output creation must not print report data')
    assert.equal(await readFile(output, 'utf8'), sentinel)
  })
})

test('M3 assessment writes a new private report while retaining honest evidence status', {
  skip: process.platform === 'win32',
}, async () => {
  await inScratch('report-private', async (root) => {
    const input = join(root, 'derived-study.json')
    const output = join(root, 'new-report.json')
    const study = buildWeeklyBasketStudyFromObservationSheet(syntheticSheet())
    await writeFile(input, JSON.stringify(study))

    const result = runCli('scripts/m3-assess-observed-week.mjs', input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    const report = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(report.reportType, 'm3-observed-week-assessment')
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.evidenceBoundary.includes('never sufficient'), true)
  })
})

for (const [label, script] of [
  ['converter', 'scripts/m3-build-observed-study.mjs'],
  ['assessment', 'scripts/m3-assess-observed-week.mjs'],
]) {
  test(`M3 ${label} does not follow an output symlink into previously reviewed data`, {
    skip: process.platform === 'win32',
  }, async () => {
    await inScratch(`${label}-symlink`, async (root) => {
      const input = join(root, 'input.json')
      const target = join(root, 'reviewed-evidence.json')
      const output = join(root, 'output-alias.json')
      const sentinel = 'previously reviewed file behind an output symlink\\n'
      const sheet = syntheticSheet()
      const data = label === 'converter'
        ? sheet
        : buildWeeklyBasketStudyFromObservationSheet(sheet)
      await writeFile(input, JSON.stringify(data))
      await writeFile(target, sentinel)
      await symlink(target, output)

      const result = runCli(script, input, output)
      assert.notEqual(result.status, 0, 'a pre-existing output symlink must be refused')
      assert.equal(result.stdout, '', 'rejected symlink must not expose evidence')
      assert.equal(await readFile(target, 'utf8'), sentinel)
      assert.equal((await lstat(output)).isSymbolicLink(), true)
    })
  })
}

test('M3 assessment refuses --output without a destination instead of printing evidence', async () => {
  await inScratch('report-missing-output', async (root) => {
    const input = join(root, 'synthetic-study.json')
    await writeFile(input, JSON.stringify(
      buildWeeklyBasketStudyFromObservationSheet(syntheticSheet()),
    ))

    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-assess-observed-week.mjs', input, '--output'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0, 'missing --output value must be a usage error')
    assert.equal(result.stdout, '', 'a malformed output option must never expose a report')
  })
})

test('M3 assessment refuses duplicate --output options before writing any report', async () => {
  await inScratch('report-duplicate-output', async (root) => {
    const input = join(root, 'synthetic-study.json')
    const first = join(root, 'first-report.json')
    const second = join(root, 'second-report.json')
    await writeFile(input, JSON.stringify(
      buildWeeklyBasketStudyFromObservationSheet(syntheticSheet()),
    ))

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/m3-assess-observed-week.mjs',
        input,
        '--output', first,
        '--output', second,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0, 'duplicate output options must be rejected')
    assert.equal(result.stdout, '', 'a rejected command must never expose a report')
    for (const output of [first, second]) {
      await assert.rejects(stat(output), { code: 'ENOENT' })
    }
  })
})

for (const [label, script] of [
  ['converter', 'scripts/m3-build-observed-study.mjs'],
  ['assessment', 'scripts/m3-assess-observed-week.mjs'],
]) {
  async function syntheticInput(root) {
    const input = join(root, 'synthetic-input.json')
    const sheet = syntheticSheet()
    const data = label === 'converter'
      ? sheet
      : buildWeeklyBasketStudyFromObservationSheet(sheet)
    await writeFile(input, JSON.stringify(data))
    return input
  }

  test(`M3 ${label} explicitly preserves stdout-only mode without --output`, async () => {
    await inScratch(`${label}-stdout-positive`, async (root) => {
      const input = await syntheticInput(root)
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, input],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      const json = JSON.parse(result.stdout)
      assert.equal(json.schemaVersion, 1)
      if (label === 'assessment') {
        assert.equal(json.publicSavingsClaimEligible, false)
      } else {
        assert.equal(json.studyId, 'synthetic-artifact-qa')
      }
    })
  })

  test(`M3 ${label} rejects option-like --output values without exposing study data`, async () => {
    await inScratch(`${label}-optionlike-output`, async (root) => {
      const input = await syntheticInput(root)
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', script, input, '--output', '--debug'],
        { cwd: process.cwd(), encoding: 'utf8' },
      )
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout, '')
    })
  })
}

test('M3 converter rejects missing --output instead of printing derived study JSON', async () => {
  await inScratch('converter-missing-output', async (root) => {
    const input = join(root, 'synthetic-sheet.json')
    await writeFile(input, JSON.stringify(syntheticSheet()))
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/m3-build-observed-study.mjs', input, '--output'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
  })
})

test('M3 converter refuses duplicate --output destinations without writing either', async () => {
  await inScratch('converter-duplicate-output', async (root) => {
    const input = join(root, 'synthetic-sheet.json')
    const first = join(root, 'first-study.json')
    const second = join(root, 'second-study.json')
    await writeFile(input, JSON.stringify(syntheticSheet()))
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types', 'scripts/m3-build-observed-study.mjs',
        input, '--output', first, '--output', second,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    for (const output of [first, second]) {
      await assert.rejects(stat(output), { code: 'ENOENT' })
    }
  })
})

test('M3 converter makes only newly created nested output directories owner-private', {
  skip: process.platform === 'win32',
}, async () => {
  await inScratch('converter-private-directories', async (root) => {
    const input = join(root, 'synthetic-sheet.json')
    const existing = join(root, 'existing-shared-parent')
    const fresh = join(existing, 'private-observations')
    const deeper = join(fresh, 'derived-study')
    const output = join(deeper, 'study.json')
    await writeFile(input, JSON.stringify(syntheticSheet()))
    await mkdir(existing)
    await chmod(existing, 0o755)

    const result = runCli('scripts/m3-build-observed-study.mjs', input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal((await stat(existing)).mode & 0o777, 0o755, 'never chmod old directories')
    for (const directory of [fresh, deeper]) {
      assert.equal((await stat(directory)).mode & 0o777, 0o700)
    }
    assert.equal((await stat(output)).mode & 0o777, 0o600)
  })
})

test('M3 assessor creates missing nested private report directories without chmodding existing ancestors', {
  skip: process.platform === 'win32',
}, async () => {
  await inScratch('assessor-private-directories', async (root) => {
    const input = join(root, 'synthetic-study.json')
    const existing = join(root, 'existing-report-parent')
    const fresh = join(existing, 'private-observations')
    const deeper = join(fresh, 'assessment-output')
    const output = join(deeper, 'assessment.json')
    await writeFile(input, JSON.stringify(
      buildWeeklyBasketStudyFromObservationSheet(syntheticSheet()),
    ))
    await mkdir(existing)
    await chmod(existing, 0o755)

    const result = runCli('scripts/m3-assess-observed-week.mjs', input, output)
    assert.equal(result.status, 0, result.stderr)
    assert.equal((await stat(existing)).mode & 0o777, 0o755)
    for (const directory of [fresh, deeper]) {
      assert.equal((await stat(directory)).mode & 0o777, 0o700)
    }
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(JSON.parse(await readFile(output, 'utf8')).publicSavingsClaimEligible, false)
  })
})
