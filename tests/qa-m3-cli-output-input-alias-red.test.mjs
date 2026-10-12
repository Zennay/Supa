import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
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

// Every case writes only inside a fresh disposable temporary directory.
// Invented unavailable items are NOT retailer receipts or M3 field evidence.
async function withSyntheticFixture(check) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-cli-alias-'))
  const sheetPath = join(dir, 'sheet.json')
  const studyPath = join(dir, 'study.json')
  const reportPath = join(dir, 'report.json')
  try {
    const generated = cli(generator, '--output', sheetPath)
    assert.equal(generated.status, 0, generated.stderr)

    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'synthetic-preservation-only',
      participantKey: 'synthetic-private-key',
      population: 'synthetic QA only',
      region: 'invented region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })

    for (const [side, store, timestamp] of [
      ['baseline', 'PLUS synthetic', '2026-10-05T11:00:00Z'],
      ['candidate', 'DekaMarkt synthetic', '2026-10-05T12:00:00Z'],
    ]) {
      const observation = sheet[side]
      observation.evidenceId = `${side}-synthetic-alias`
      observation.observedAt = timestamp
      observation.source = 'manual-cart'
      observation.provenanceNote = 'PRIVATE_SYNTHETIC_NOTE_NOT_A_REAL_RECEIPT'
      observation.store = { id: `${side}-synthetic-store`, name: store }
      for (const line of observation.lines) line.observedProduct.available = false
    }
    const originalSheet = JSON.stringify(sheet, null, 2) + '\n'
    await writeFile(sheetPath, originalSheet, 'utf8')
    await check({ dir, sheetPath, studyPath, reportPath, originalSheet })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function aliasFor({ dir }, original, variant, prefix) {
  if (variant === 'identical') return original
  if (variant === 'normalized') {
    const middle = join(dir, prefix + '-sub')
    await mkdir(middle)
    return `${middle}/../${original.split('/').at(-1)}`
  }
  const alias = join(dir, prefix + (variant === 'hardlink' ? '-hardlink.json' : '-symlink.json'))
  if (variant === 'hardlink') await link(original, alias)
  else await symlink(original, alias)
  return alias
}

for (const variant of ['identical', 'normalized', 'symlink', 'hardlink']) {
  test(`converter cannot replace its source observation sheet via ${variant} --output alias (#2035 expected RED)`, async () => {
    await withSyntheticFixture(async (ctx) => {
      const output = await aliasFor(ctx, ctx.sheetPath, variant, 'converter')
      const result = cli(converter, ctx.sheetPath, '--output', output)
      assert.equal(
        await readFile(ctx.sheetPath, 'utf8'),
        ctx.originalSheet,
        'field collection input bytes must survive even when output aliases input',
      )
      assert.notEqual(result.status, 0, 'converter must refuse an output alias')
      assert.equal(result.stdout.trim(), '', 'no private study may escape to stdout')
      assert.equal(result.stderr.includes('synthetic-private-key'), false)
      if (variant === 'symlink' || variant === 'hardlink') assert.equal(existsSync(output), true)
    })
  })

  test(`assessor cannot replace its source study via ${variant} --output alias (#2035 expected RED)`, async () => {
    await withSyntheticFixture(async (ctx) => {
      const converted = cli(converter, ctx.sheetPath, '--output', ctx.studyPath)
      assert.equal(converted.status, 0, converted.stderr)
      const originalStudy = await readFile(ctx.studyPath, 'utf8')
      const output = await aliasFor(ctx, ctx.studyPath, variant, 'assessor')
      const result = cli(assessor, ctx.studyPath, '--output', output)
      assert.equal(
        await readFile(ctx.studyPath, 'utf8'),
        originalStudy,
        'derived study input bytes must survive even when report output aliases input',
      )
      assert.notEqual(result.status, 0, 'assessor must refuse an output alias')
      assert.equal(result.stdout.trim(), '', 'no private report may escape to stdout')
      assert.equal(result.stderr.includes('synthetic-private-key'), false)
      if (variant === 'symlink' || variant === 'hardlink') assert.equal(existsSync(output), true)
    })
  })
}

test('distinct paths retain canonical synthetic generator -> converter -> assessor flow with no savings claim', async () => {
  await withSyntheticFixture(async (ctx) => {
    const converted = cli(converter, ctx.sheetPath, '--output', ctx.studyPath)
    assert.equal(converted.status, 0, converted.stderr)
    const study = JSON.parse(await readFile(ctx.studyPath, 'utf8'))
    assert.equal(study.baseline.basket.lines.length, 11)
    assert.equal(study.candidate.basket.lines.length, 11)
    assert.equal(await readFile(ctx.sheetPath, 'utf8'), ctx.originalSheet)

    const assessed = cli(assessor, ctx.studyPath, '--output', ctx.reportPath)
    assert.equal(assessed.status, 0, assessed.stderr)
    const reportText = await readFile(ctx.reportPath, 'utf8')
    const report = JSON.parse(reportText)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.savingsCents, null)
    assert.equal(report.deltaCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(reportText.includes('synthetic-private-key'), false)
    assert.equal(reportText.includes('PRIVATE_SYNTHETIC_NOTE'), false)
  })
})
