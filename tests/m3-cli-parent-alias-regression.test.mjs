import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Independent synthetic extension to #2035 / DRAFT #2036:
// directory symlinks and chains of directory symlinks can alias the original
// evidence inode even though neither --output string is the input path.
// Never use genuine field sheets or participant / retailer observations here.
const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function run(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

async function withSyntheticInputs(check) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-parent-alias-'))
  const sheetPath = join(dir, 'sheet.json')
  const studyPath = join(dir, 'study.json')
  try {
    const generated = run(generator, '--output', sheetPath)
    assert.equal(generated.status, 0, generated.stderr)

    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'synthetic-parent-alias-only',
      participantKey: 'synthetic-private-marker',
      population: 'fictional QA only',
      region: 'invented QA region',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })
    for (const [side, name, at] of [
      ['baseline', 'PLUS fictional', '2026-10-05T11:00:00Z'],
      ['candidate', 'DekaMarkt fictional', '2026-10-05T12:00:00Z'],
    ]) {
      const observation = sheet[side]
      observation.evidenceId = `${side}-synthetic-parent`
      observation.observedAt = at
      observation.source = 'manual-cart'
      observation.provenanceNote = 'PRIVATE_SYNTHETIC_PROVENANCE_NOT_A_REAL_RECEIPT'
      observation.store = { id: `${side}-fictional-store`, name }
      for (const line of observation.lines) {
        line.observedProduct.available = false
      }
    }
    const originalSheet = `${JSON.stringify(sheet, null, 2)}\n`
    await writeFile(sheetPath, originalSheet, 'utf8')

    const first = join(dir, 'symlink-parent')
    const second = join(dir, 'symlink-parent-chain')
    await symlink(dir, first, 'dir')
    await symlink(first, second, 'dir')
    await check({ dir, sheetPath, studyPath, originalSheet, first, second })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function assertNoPrivateOutput(result) {
  assert.equal(result.stdout.trim(), '')
  assert.equal(result.stderr.includes('synthetic-private-marker'), false)
  assert.equal(result.stderr.includes('PRIVATE_SYNTHETIC_PROVENANCE'), false)
}

for (const [label, alias] of [
  ['single directory symlink', 'first'],
  ['chained directory symlink', 'second'],
]) {
  test(`converter preserves input sheet when --output traverses ${label} (#2035 postrepair)`, async () => {
    await withSyntheticInputs(async (ctx) => {
      const output = join(ctx[alias], 'sheet.json')
      const result = run(converter, ctx.sheetPath, '--output', output)
      assert.equal(
        await readFile(ctx.sheetPath, 'utf8'),
        ctx.originalSheet,
        'original human-field-sheet analogue must stay byte-for-byte intact',
      )
      assert.notEqual(result.status, 0, 'aliased output must be rejected')
      assertNoPrivateOutput(result)
    })
  })

  test(`assessor preserves input study when --output traverses ${label} (#2035 postrepair)`, async () => {
    await withSyntheticInputs(async (ctx) => {
      const prepared = run(converter, ctx.sheetPath, '--output', ctx.studyPath)
      assert.equal(prepared.status, 0, prepared.stderr)
      const originalStudy = await readFile(ctx.studyPath, 'utf8')
      const output = join(ctx[alias], 'study.json')
      const result = run(assessor, ctx.studyPath, '--output', output)
      assert.equal(
        await readFile(ctx.studyPath, 'utf8'),
        originalStudy,
        'original assessment study must remain byte-for-byte intact',
      )
      assert.notEqual(result.status, 0, 'aliased output must be rejected')
      assertNoPrivateOutput(result)
    })
  })
}

test('a distinct report under a symlinked ancestor is rejected without exposing private data (#1140)', async () => {
  await withSyntheticInputs(async (ctx) => {
    const converted = run(converter, ctx.sheetPath, '--output', ctx.studyPath)
    assert.equal(converted.status, 0, converted.stderr)
    const originalStudy = await readFile(ctx.studyPath, 'utf8')
    const reportPath = join(ctx.second, 'separate-report.json')
    const assessed = run(assessor, ctx.studyPath, '--output', reportPath)
    assert.notEqual(assessed.status, 0, 'a distinct output is not safe through a symlinked parent')
    assertNoPrivateOutput(assessed)
    assert.match(assessed.stderr, /refusing symlinked M3 output parent directory/u)
    await assert.rejects(readFile(join(ctx.dir, 'separate-report.json')), { code: 'ENOENT' })
    assert.equal(await readFile(ctx.studyPath, 'utf8'), originalStudy)
    assert.equal(await readFile(ctx.sheetPath, 'utf8'), ctx.originalSheet)
  })
})
