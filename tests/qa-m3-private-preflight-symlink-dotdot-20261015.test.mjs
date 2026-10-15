import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'

// Node's lexical path.resolve discards a link/.. pair before inspection.
// The kernel follows the link before traversing .. . Test actual CLI paths.
const SHA = '1234567890abcdef1234567890abcdef12345678'
const demand = buildObservationSheet()
function observation(side) {
  return {
    evidenceId: 'synthetic-' + side,
    observedAt: side === 'baseline'
      ? '2026-10-14T11:00:00Z' : '2026-10-14T12:00:00Z',
    source: 'manual-cart',
    provenanceNote: 'fictional evidence only',
    basket: {
      store: side === 'baseline'
        ? { id: 'plus-fictional', name: 'PLUS' }
        : { id: 'deka-fictional', name: 'DekaMarkt' },
      selectedMealCount: demand.selectedMealCount,
      lines: demand.requirements.map(x => ({
        id: x.id, ingredientLabel: x.label,
        requirement: { amount: x.amount, unit: x.unit },
        status: 'unresolved', reasons: ['fictional unmatched'],
        matchScore: null,
      })),
      totalCents: 0, matchedLineCount: 0,
      unresolvedLineCount: demand.requirements.length,
    },
  }
}
function study() {
  return {
    schemaVersion: 1, studyId: 'synthetic-dotdot-qa',
    participantKey: 'synthetic-identifier', population: 'fictional students',
    region: 'fictional region', weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: observation('baseline'), candidate: observation('candidate'),
  }
}
function cli(source, pin) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', 'scripts/m3-verify-private-week-preflight.mjs',
    source, pin, '--expect-main-sha', SHA,
  ], { encoding: 'utf8', timeout: 8000 })
}
async function withSyntheticPrivatePaths(run) {
  const tmp = await mkdtemp(join(tmpdir(), 'supa-m3-dotdot-'))
  try {
    const safe = join(tmp, 'safe')
    const entry = join(tmp, 'outside', 'entry')
    const real = join(tmp, 'outside', 'real')
    await mkdir(safe)
    await mkdir(entry, { recursive: true })
    await mkdir(real)
    const studyBytes = Buffer.from(JSON.stringify(study()))
    const manifestBytes = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(studyBytes, SHA)))
    const properStudy = join(real, 'study.json')
    const properPin = join(real, 'pin.json')
    await writeFile(properStudy, studyBytes, { mode: 0o600 })
    await writeFile(properPin, manifestBytes, { mode: 0o600 })
    const link = join(safe, 'link')
    await symlink(entry, link, 'dir')
    // Avoid join() and resolve() here: both remove the critical link/..
    const aliasStudy = link + '/../real/study.json'
    const aliasPin = link + '/../real/pin.json'
    assert.notEqual(resolve(aliasStudy), properStudy)
    // Prove the OS can actually read the fixture through the dangerous alias.
    assert.deepEqual(await readFile(aliasStudy), studyBytes)
    assert.deepEqual(await readFile(aliasPin), manifestBytes)
    await run({ properStudy, properPin, aliasStudy, aliasPin })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
function denied(proc) {
  assert.equal(proc.error, undefined, String(proc.error))
  assert.equal(proc.status, 1, 'unsafe parent must not be admitted')
  assert.equal(proc.stdout, '')
  assert.equal(proc.stderr.trim(), 'M3 private study provenance preflight refused')
  assert.doesNotMatch(proc.stderr, /supa-m3-dotdot-|study\.json|pin\.json|synthetic-identifier/)
}

test('M3 normal direct source and manifest remain private-only', async () => {
  await withSyntheticPrivatePaths(async ({ properStudy, properPin }) => {
    const proc = cli(properStudy, properPin)
    assert.equal(proc.error, undefined, String(proc.error))
    assert.equal(proc.status, 0, proc.stderr)
    const report = JSON.parse(proc.stdout)
    assert.equal(report.status, 'private-review-only')
    assert.equal(report.canonicalDemandLineCount, 11)
    for (const key of [
      'sourceCommitShaAuthenticated', 'codeRevisionVerified',
      'retailerPermissionVerified', 'publicSavingsClaimEligible',
    ]) assert.equal(report[key], false, key)
  })
})

test('M3 preflight refuses symlink-before-dotdot in STUDY source ancestry', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux symlink semantics')
  await withSyntheticPrivatePaths(async ({ properPin, aliasStudy }) => {
    denied(cli(aliasStudy, properPin))
  })
})

test('M3 preflight refuses symlink-before-dotdot in MANIFEST ancestry', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux symlink semantics')
  await withSyntheticPrivatePaths(async ({ properStudy, aliasPin }) => {
    denied(cli(properStudy, aliasPin))
  })
})
