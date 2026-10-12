import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const generator = fileURLToPath(new URL('../scripts/m3-create-observation-sheet.mjs', import.meta.url))
const converter = fileURLToPath(new URL('../scripts/m3-build-observed-study.mjs', import.meta.url))
const assessor = fileURLToPath(new URL('../scripts/m3-assess-observed-week.mjs', import.meta.url))

function run(script, ...args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
    encoding: 'utf8',
  })
}

async function withGeneratedSheet(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-unobserved-'))
  const input = join(dir, 'collector.json')
  const study = join(dir, 'study.json')
  const report = join(dir, 'report.json')

  try {
    const generated = run(generator, '--output', input)
    assert.equal(generated.status, 0, generated.stderr)
    const initial = await readFile(input, 'utf8')
    const sheet = JSON.parse(initial)
    assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
    assert.equal(sheet.requirements.length, 11)
    await fn({ sheet, input, study, report, initial })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function addMetadataWithoutProducts(sheet) {
  sheet.study.studyId = 'synthetic-unobserved-validation'
  sheet.study.participantKey = 'synthetic-student'
  sheet.study.population = 'synthetic fixture only'
  sheet.study.region = 'synthetic test region'
  sheet.study.weekStart = '2026-10-05'
  sheet.study.priceContext = 'in-store'

  for (const [side, name, time] of [
    ['baseline', 'PLUS synthetic fixture', '2026-10-05T10:00:00Z'],
    ['candidate', 'DekaMarkt synthetic fixture', '2026-10-05T11:00:00Z'],
  ]) {
    sheet[side].evidenceId = `${side}-synthetic-001`
    sheet[side].observedAt = time
    sheet[side].provenanceNote = 'synthetic QA fixture, never field evidence'
    sheet[side].store.id = `${side}-synthetic-store`
    sheet[side].store.name = name
  }
}

test('generated M3 collection template cannot be converted or emitted as genuine study evidence', async () => {
  await withGeneratedSheet(async ({ input, study, initial }) => {
    const result = run(converter, input, '--output', study)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /sheet\.study\.studyId must be a non-empty string/)
    assert.equal(result.stdout.trim(), '')
    assert.equal(existsSync(study), false)
    assert.equal(await readFile(input, 'utf8'), initial)
  })
})

test('M3 CLI refuses metadata-only synthetic field sheet with unmeasured availability and does not write output', async () => {
  await withGeneratedSheet(async ({ sheet, input, study }) => {
    addMetadataWithoutProducts(sheet)
    const serialized = `${JSON.stringify(sheet, null, 2)}\n`
    await writeFile(input, serialized, 'utf8')
    const result = run(converter, input, '--output', study)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /baseline\.lines\[0\]\.observedProduct\.available must be true or false/)
    assert.equal(result.stdout.trim(), '')
    assert.equal(existsSync(study), false)
    assert.equal(await readFile(input, 'utf8'), serialized)
  })
})

test('synthetic all-unavailable basket may be assessed but never yields monetary savings or a public claim', async () => {
  await withGeneratedSheet(async ({ sheet, input, study, report }) => {
    addMetadataWithoutProducts(sheet)
    for (const side of ['baseline', 'candidate']) {
      for (const line of sheet[side].lines) {
        line.observedProduct.available = false
      }
    }
    await writeFile(input, `${JSON.stringify(sheet, null, 2)}\n`, 'utf8')
    const conversion = run(converter, input, '--output', study)
    assert.equal(conversion.status, 0, conversion.stderr)
    const assessment = run(assessor, study, '--output', report)
    assert.equal(assessment.status, 0, assessment.stderr)
    const result = JSON.parse(await readFile(report, 'utf8'))
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.baseline.matchedLineCount, 0)
    assert.equal(result.candidate.matchedLineCount, 0)
    assert.equal(result.baseline.unresolvedLineCount, 11)
    assert.equal(result.candidate.unresolvedLineCount, 11)
    assert.equal(result.savingsCents, null)
  })
})
