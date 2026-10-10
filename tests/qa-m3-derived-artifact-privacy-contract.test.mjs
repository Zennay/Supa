import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
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
