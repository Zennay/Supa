import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'

const entry = fileURLToPath(new URL('../scripts/qa-m3-field-run-code-pin-cli-20261017.mjs', import.meta.url))
const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const ERROR = 'M3 private field-run pin proof refused\n'
const PRIVATE = 'private-fictional-operator-20261017'
const runner = (...args) => spawnSync(process.execPath,
  ['--experimental-strip-types', entry, ...args],
  { encoding: 'utf8', timeout: 15000 })

async function withArtifacts(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-field-pin-'))
  try {
    await chmod(dir, 0o700)
    const sheet = buildFictionalPricedSheet(90)
    sheet.study.participantKey = PRIVATE
    const study = buildWeeklyBasketStudyFromObservationSheet(sheet)
    const assessment = buildObservedWeekReport(study)
    sheet.study.fieldRunCommitSha = SHA
    study.fieldRunCommitSha = SHA
    assessment.fieldRunCommitSha = SHA
    const paths = [join(dir, 'sheet.json'), join(dir, 'study.json'), join(dir, 'assessment.json')]
    for (const [index, value] of [sheet, study, assessment].entries()) {
      await writeFile(paths[index], JSON.stringify(value), { mode: 0o600 })
    }
    const args = ['--sheet', paths[0], '--study', paths[1],
      '--assessment', paths[2], '--expected-main-sha', SHA]
    await fn({ dir, paths, args, sheet, study, assessment })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function refusal(result) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, ERROR)
  assert.doesNotMatch(result.stderr, /private-fictional|sheet.json|study.json|assessment.json|[a-f0-9]{40}/u)
}

test('genuine local 0600 private three-artifact CLI checks independent current-main pin without leaking it', async () => {
  await withArtifacts(async ({ paths, args }) => {
    const result = runner(...args)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const proof = JSON.parse(result.stdout)
    assert.equal(proof.codePinMatched, true)
    assert.equal(proof.canonicalPhysicalProjectionBound, true)
    assert.equal(proof.publicSavingsClaimEligible, false)
    assert.equal(proof.verifiedRetailerObservations, false)
    assert.equal(proof.m3ExitProven, false)
    assert.doesNotMatch(result.stdout, /private-fictional|PLUS|DekaMarkt|[a-f0-9]{40}/u)
    assert.equal(JSON.parse(await readFile(paths[0], 'utf8')).study.fieldRunCommitSha, SHA)
  })
})

test('copied SHA cannot mask changed original field cents or final assessment', async () => {
  await withArtifacts(async ({ paths, args, sheet, assessment }) => {
    const changed = structuredClone(sheet)
    changed.candidate.lines[0].observedProduct.priceCents += 1
    await writeFile(paths[0], JSON.stringify(changed), { mode: 0o600 })
    refusal(runner(...args))
    await writeFile(paths[0], JSON.stringify(sheet), { mode: 0o600 })
    const wrong = structuredClone(assessment)
    wrong.candidate.totalCents++
    await writeFile(paths[2], JSON.stringify(wrong), { mode: 0o600 })
    refusal(runner(...args))
  })
})

test('CLI independently refuses wrong SHA, malformed args, same path or untrusted file permissions', async () => {
  await withArtifacts(async ({ paths, args }) => {
    refusal(runner(...args.slice(0, -1), OTHER))
    refusal(runner(...args.slice(0, -1), SHA.toUpperCase()))
    refusal(runner(...args, '--verbose'))
    refusal(runner('--sheet', paths[0], '--study', paths[0],
      '--assessment', paths[2], '--expected-main-sha', SHA))
    await chmod(paths[1], 0o644)
    refusal(runner(...args))
  })
})

test('private input symlink, duplicate JSON keys and altered source SHA all fail closed', async () => {
  await withArtifacts(async ({ paths, args, sheet, dir }) => {
    const link = join(dir, 'symlink-study.json')
    await symlink(paths[1], link)
    refusal(runner('--sheet', paths[0], '--study', link,
      '--assessment', paths[2], '--expected-main-sha', SHA))
    const raw = await readFile(paths[0], 'utf8')
    await writeFile(paths[0], raw.replace(
      '"fieldRunCommitSha":"' + SHA + '"',
      '"fieldRunCommitSha":"' + SHA + '","fieldRunCommitSha":"' + SHA + '"'
    ), { mode: 0o600 })
    refusal(runner(...args))
    sheet.study.fieldRunCommitSha = OTHER
    await writeFile(paths[0], JSON.stringify(sheet), { mode: 0o600 })
    refusal(runner(...args))
  })
})
