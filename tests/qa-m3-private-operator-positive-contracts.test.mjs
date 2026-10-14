import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { link, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeDerivedM3Output } from '../scripts/m3-source-output-preservation.mjs'

// Independent GREEN-only M3 operator contracts. An unrelated race-fix is NOT
// established by these tests; see #2039 / intentionally RED #2539.
const PRIVATE = 'FICTIONAL_QA_PRIVATE_MARKER_NOT_A_PERSON'
const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

async function withPrivateDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-qa-operator-'))
  try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

function run(script, ...args) {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8', timeout: 15000,
  })
  assert.ifError(result.error)
  assert.equal((result.stdout + result.stderr).includes(PRIVATE), false,
    'private provenance must never be echoed in process output')
  return result
}

test('M3 fresh and repeated distinct reports retain exact data, source and private mode', async () => {
  await withPrivateDir(async (dir) => {
    const input = join(dir, 'source.json')
    const output = join(dir, 'derived.json')
    const original = JSON.stringify({ evidence: PRIVATE }) + '\n'
    const first = '{"outcome":"unknown","savingsCents":null}\n'
    const second = '{"outcome":"same","savingsCents":0}\n'
    await writeFile(input, original)
    await writeDerivedM3Output(input, output, first)
    assert.equal(await readFile(output, 'utf8'), first)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    await writeDerivedM3Output(input, output, second)
    assert.equal(await readFile(output, 'utf8'), second)
    assert.equal((await stat(output)).mode & 0o777, 0o600)
    assert.equal(await readFile(input, 'utf8'), original)
  })
})

test('M3 output must refuse same path, input hardlink and private symlink aliases', async () => {
  await withPrivateDir(async (dir) => {
    const input = join(dir, 'source.json')
    const hardAlias = join(dir, 'source-hardlink.json')
    const symlinkAlias = join(dir, 'source-symlink.json')
    const original = JSON.stringify({ evidence: PRIVATE }) + '\n'
    await writeFile(input, original)
    await link(input, hardAlias)
    await symlink(input, symlinkAlias)
    for (const output of [input, hardAlias, symlinkAlias]) {
      await assert.rejects(() => writeDerivedM3Output(input, output, '{"derived":true}\n'))
    }
    assert.equal((await lstat(symlinkAlias)).isSymbolicLink(), true)
    assert.equal(await readFile(input, 'utf8'), original)
  })
})

test('M3 converter and assessor preserve original synthetic unavailable field sheet and report unknown', async () => {
  await withPrivateDir(async (dir) => {
    const sheetPath = join(dir, 'sheet.json')
    const studyPath = join(dir, 'study.json')
    const reportPath = join(dir, 'report.json')
    const generate = run(generator, '--output', sheetPath)
    assert.equal(generate.status, 0, generate.stderr)
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'))
    assert.equal(sheet.requirements.length, 11)
    Object.assign(sheet.study, {
      studyId: 'fictional-private-qa',
      participantKey: 'fictional-operator-key',
      population: 'fictional QA cohort',
      region: 'fictional QA place',
      weekStart: '2026-10-05',
      priceContext: 'in-store',
    })
    for (const [side, name, hour] of [
      ['baseline', 'PLUS fictional', '11'],
      ['candidate', 'DekaMarkt fictional', '12'],
    ]) {
      const basket = sheet[side]
      basket.evidenceId = side + '-fictional-qa'
      basket.observedAt = '2026-10-05T' + hour + ':00:00Z'
      basket.source = 'manual-cart'
      basket.provenanceNote = PRIVATE
      basket.store = { id: side + '-fictional-store', name }
      assert.equal(basket.lines.length, 11)
      for (const line of basket.lines) line.observedProduct.available = false
    }
    const original = JSON.stringify(sheet, null, 2) + '\n'
    await writeFile(sheetPath, original)
    const converted = run(converter, sheetPath, '--output', studyPath)
    assert.equal(converted.status, 0, converted.stderr)
    assert.equal(converted.stdout, '')
    assert.equal(await readFile(sheetPath, 'utf8'), original)
    const studyBytes = await readFile(studyPath, 'utf8')
    assert.equal((await stat(studyPath)).mode & 0o777, 0o600)
    const assessed = run(assessor, studyPath, '--output', reportPath)
    assert.equal(assessed.status, 0, assessed.stderr)
    assert.equal(assessed.stdout, '')
    assert.equal(await readFile(studyPath, 'utf8'), studyBytes)
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600)
    const reportText = await readFile(reportPath, 'utf8')
    assert.equal(reportText.includes(PRIVATE), false)
    const report = JSON.parse(reportText)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.claimable, false)
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
  })
})

