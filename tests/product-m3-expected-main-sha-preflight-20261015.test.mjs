import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week, assertUnambiguousM3StudyJson } from '../scripts/m3-verify-private-week-preflight.mjs'

const MAIN = 'abcdef1234567890abcdef1234567890abcdef12'
const WRONG = '1234567890abcdef1234567890abcdef12345678'
const demand = buildObservationSheet()
function evidence(side, timestamp) {
  return {
    evidenceId: 'synthetic-' + side,
    observedAt: timestamp,
    source: 'manual-cart',
    provenanceNote: 'fictional test data',
    basket: {
      store: side === 'baseline'
        ? { id: 'plus-local', name: 'PLUS' }
        : { id: 'deka-local', name: 'DekaMarkt' },
      selectedMealCount: demand.selectedMealCount,
      lines: demand.requirements.map((item) => ({
        id: item.id, ingredientLabel: item.label,
        requirement: { amount: item.amount, unit: item.unit },
        status: 'unresolved', reasons: ['not a real price observation'],
        matchScore: null,
      })),
      totalCents: 0, matchedLineCount: 0,
      unresolvedLineCount: demand.requirements.length,
    },
  }
}
function privatePair() {
  const studyBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    studyId: 'synthetic-week-check',
    participantKey: 'synthetic-only',
    population: 'fictional students',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
    baseline: evidence('baseline', '2026-10-14T11:00:00Z'),
    candidate: evidence('candidate', '2026-10-14T12:00:00Z'),
  }))
  const pinBytes = Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(studyBytes, MAIN)))
  return { studyBytes, pinBytes }
}

test('operator can require matching separately checked main SHA without upgrading proof flags', () => {
  const { studyBytes, pinBytes } = privatePair()
  const result = preflightPrivateM3Week(studyBytes, pinBytes, MAIN)
  assert.equal(result.sourceCommitSha, MAIN)
  assert.equal(result.privateStudyBytesMatch, true)
  assert.equal(result.sourceCommitShaAuthenticated, false)
  assert.equal(result.codeRevisionVerified, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.status, 'private-review-only')
})

test('operator SHA mismatches and malformed pins fail closed with private-safe errors', () => {
  const { studyBytes, pinBytes } = privatePair()
  for (const expected of [
    WRONG, MAIN.toUpperCase(), MAIN + '0', '0'.repeat(40), '', ' HEAD ', undefined, false, {}, 99,
  ]) {
    // Undefined is rejected too; only an omitted third argument means legacy mode.
    const actual = expected === undefined ? '' : expected
    assert.throws(
      () => preflightPrivateM3Week(studyBytes, pinBytes, actual),
      (error) => error.message === 'M3 private study provenance preflight refused',
    )
  }
  const legacy = preflightPrivateM3Week(studyBytes, pinBytes)
  assert.equal(legacy.sourceCommitShaAuthenticated, false)
})

test('M3 CLI explicit main SHA policy succeeds privately, rejects wrong SHA and extra args', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-main-pin-'))
  try {
    const { studyBytes, pinBytes } = privatePair()
    const studyPath = join(dir, 'private-study.json')
    const pinPath = join(dir, 'private-pin.json')
    await writeFile(studyPath, studyBytes, { mode: 0o600 })
    await writeFile(pinPath, pinBytes, { mode: 0o600 })
    const base = [
      '--experimental-strip-types',
      'scripts/m3-verify-private-week-preflight.mjs',
      studyPath, pinPath,
    ]
    const run = (args) => spawnSync(process.execPath, [...base, ...args], {
      encoding: 'utf8', timeout: 5000,
    })
    const green = run(['--expect-main-sha', MAIN])
    assert.equal(green.status, 0, green.stderr)
    assert.equal(JSON.parse(green.stdout).sourceCommitShaAuthenticated, false)
    assert.doesNotMatch(green.stdout, /synthetic-only|fictional region|not a real price/)
    for (const args of [
      ['--expect-main-sha', WRONG],
      ['--expect-main-sha', MAIN.toUpperCase()],
      ['--expect-main-sha'],
      ['--expect-main-sha', MAIN, 'extra'],
      ['--unexpected', MAIN],
    ]) {
      const red = run(args)
      assert.equal(red.error, undefined, String(red.error))
      assert.equal(red.status, 1, red.stderr)
      assert.equal(red.stdout, '')
      assert.doesNotMatch(red.stderr, /synthetic-only|fictional region|private-study\.json|private-pin\.json/)
    }
    const unpinned = run([])
    assert.equal(unpinned.status, 0, unpinned.stderr)
    assert.equal(JSON.parse(unpinned.stdout).codeRevisionVerified, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('private M3 parser bounds number of scalar JSON values without rejecting valid many-value input', () => {
  // 99,999 entries plus the root array reach the documented 100k budget.
  const withinBudget = '[' + Array(99999).fill('0').join(',') + ']'
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(withinBudget))
  const overBudget = '[' + Array(100000).fill('0').join(',') + ']'
  assert.throws(() => assertUnambiguousM3StudyJson(overBudget), /preflight refused/)
})

test('bounded sticky primitive scanner preserves exact JSON numeric and literal grammar', () => {
  const valid = '[true,false,null,0,-0,12,-34.50,1e3,2E-4,6.022e+23,{"nested":[0,1]}]'
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(valid))
  for (const malformed of [
    '[truefalse]', '[nul]', '[01]', '[1e]', '[2E+]', '[.5]', '[1.]',
    '[NaN]', '[Infinity]', '[falsee]', '[true,]', '[--1]', '[1 2]',
  ]) {
    assert.throws(() => assertUnambiguousM3StudyJson(malformed), /preflight refused/)
  }
})
