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

function cli(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

// The generated 11-line requirement list is a fixture, not a real store observation.
async function withUnavailableSyntheticSheet(check) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-demand-integrity-'))
  const input = join(directory, 'synthetic-sheet.json')
  const output = join(directory, 'derived-study.json')
  const report = join(directory, 'report.json')
  try {
    const generation = cli(generator, '--output', input)
    assert.equal(generation.status, 0, generation.stderr)
    const sheet = JSON.parse(await readFile(input, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    sheet.study = {
      ...sheet.study,
      studyId: 'synthetic-canonical-demand',
      participantKey: 'synthetic-pseudonym',
      population: 'synthetic test only',
      region: 'synthetic region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    }
    for (const [side, store, at] of [
      ['baseline', 'PLUS synthetic test', '2026-10-05T10:00:00Z'],
      ['candidate', 'DekaMarkt synthetic test', '2026-10-05T11:00:00Z'],
    ]) {
      sheet[side].evidenceId = `${side}-synthetic-demand`
      sheet[side].observedAt = at
      sheet[side].store = { id: `${side}-test-store`, name: store }
      sheet[side].source = 'manual-cart'
      sheet[side].provenanceNote = 'SYNTHETIC QA ONLY; NO RETAILER DATA'
      sheet[side].lines.forEach((line) => {
        line.observedProduct.available = false
      })
    }
    await check({ sheet, input, output, report })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function expectConversionRefusal({ sheet, input, output }, diagnostic) {
  const serialized = JSON.stringify(sheet, null, 2) + '\n'
  await writeFile(input, serialized, 'utf8')
  const result = cli(converter, input, '--output', output)
  assert.notEqual(result.status, 0, 'converter unexpectedly accepted a tampered field sheet')
  assert.match(result.stderr, diagnostic)
  assert.equal(result.stdout.trim(), '', 'no private derived study may escape to stdout')
  assert.equal(existsSync(output), false, 'no derived study may be created on failure')
  assert.equal(await readFile(input, 'utf8'), serialized, 'original evidence must remain intact')
}

test('unmodified synthetic 11+11 unavailable canonical demands produce only unknown/null study evidence', async () => {
  await withUnavailableSyntheticSheet(async ({ sheet, input, output, report }) => {
    await writeFile(input, JSON.stringify(sheet), 'utf8')
    const converted = cli(converter, input, '--output', output)
    assert.equal(converted.status, 0, converted.stderr)
    const study = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(study.baseline.basket.lines.length, 11)
    assert.equal(study.candidate.basket.lines.length, 11)
    assert.ok(study.baseline.basket.lines.every((line) => line.status === 'unresolved'))
    assert.ok(study.candidate.basket.lines.every((line) => line.status === 'unresolved'))
    const assessed = cli(assessor, output, '--output', report)
    assert.equal(assessed.status, 0, assessed.stderr)
    const result = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.savingsCents, null)
    assert.equal(result.deltaCents, null)
    assert.equal(result.publicSavingsClaimEligible, false)
  })
})

test('CLI rejects same-length permuted PLUS ingredient entries rather than reassign demand', async () => {
  await withUnavailableSyntheticSheet(async (ctx) => {
    const { lines } = ctx.sheet.baseline
    ;[lines[0], lines[1]] = [lines[1], lines[0]]
    await expectConversionRefusal(ctx, /baseline\.lines\[0\]\.ingredientId must remain/)
  })
})

test('CLI refuses unit and quantity changes on a DekaMarkt line despite unchanged ingredient ID', async () => {
  for (const mutate of [
    (line) => { line.requirement.amount += 1 },
    (line) => { line.requirement.unit = line.requirement.unit === 'g' ? 'kg' : 'g' },
  ]) {
    await withUnavailableSyntheticSheet(async (ctx) => {
      mutate(ctx.sheet.candidate.lines[0])
      await expectConversionRefusal(ctx, /candidate\.lines\[0\]\.requirement must match the canonical planner demand/)
    })
  }
})

test('CLI refuses a forged root canonical demand snapshot even when both stores copy the change', async () => {
  await withUnavailableSyntheticSheet(async (ctx) => {
    ctx.sheet.requirements[0].amount += 1
    for (const side of ['baseline', 'candidate']) {
      ctx.sheet[side].lines[0].requirement.amount += 1
    }
    await expectConversionRefusal(ctx, /sheet\.requirements must exactly match the canonical planner demand/)
  })
})

test('CLI refuses a missing DekaMarkt ingredient even when remaining products are explicitly unavailable', async () => {
  await withUnavailableSyntheticSheet(async (ctx) => {
    ctx.sheet.candidate.lines.pop()
    await expectConversionRefusal(ctx, /candidate\.lines must contain the exact canonical requirement count/)
  })
})

test('CLI refuses a wider declared field window instead of permitting a 48h savings story', async () => {
  await withUnavailableSyntheticSheet(async (ctx) => {
    ctx.sheet.study.maxObservationWindowHours = 48
    await expectConversionRefusal(ctx, /sheet\.study\.maxObservationWindowHours must remain 24/)
  })
})

test('CLI refuses mixing online and in-store contexts in one fabricated study context', async () => {
  await withUnavailableSyntheticSheet(async (ctx) => {
    ctx.sheet.study.priceContext = 'mixed'
    await expectConversionRefusal(ctx, /sheet\.study\.priceContext must be in-store or online-order/)
  })
})
