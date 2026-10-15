import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const SHA = '1234567890abcdef1234567890abcdef12345678'
const fixture = buildObservationSheet()
const weekStart = '2026-10-12'
const canonicalLines = () => fixture.requirements.map(r => ({
  id: r.id,
  ingredientLabel: r.label,
  requirement: { amount: r.amount, unit: r.unit },
  status: 'unresolved',
  reasons: ['product quantity unverified'],
  matchScore: null,
}))
const evidence = (side, observedAt) => ({
  evidenceId: 'synthetic-' + side,
  observedAt,
  source: 'manual-cart',
  provenanceNote: 'fictional private test',
  basket: {
    store: {
      id: side === 'baseline' ? 'plus-local' : 'deka-local',
      name: side === 'baseline' ? 'PLUS' : 'DekaMarkt',
    },
    selectedMealCount: fixture.selectedMealCount,
    lines: canonicalLines(),
    totalCents: 0,
    matchedLineCount: 0,
    unresolvedLineCount: fixture.requirements.length,
  },
})
function syntheticStudy() {
  return {
    schemaVersion: 1,
    studyId: 'fake-study-20261015',
    participantKey: 'fake-participant-key',
    population: 'synthetic students only',
    region: 'fictional test region',
    weekStart,
    priceContext: 'in-store',
    baseline: evidence('baseline', '2026-10-14T11:00:00Z'),
    candidate: evidence('candidate', '2026-10-14T12:00:00Z'),
  }
}
const encoded = (study) => Buffer.from(JSON.stringify(study))
const pinned = (bytes) => Buffer.from(JSON.stringify(createPrivateM3StudyCodePin(bytes, SHA)))
function evaluate(study) {
  const input = encoded(study)
  return preflightPrivateM3Week(input, pinned(input))
}

test('M3 private preflight binds valid canonical 11x2 evidence without publishing euros', () => {
  const result = evaluate(syntheticStudy())
  assert.deepEqual(result, {
    status: 'private-review-only',
    privateStudyBytesMatch: true,
    canonicalDemandLineCount: 11,
    sameDemandLineCount: 11,
    observationWindowWithin24Hours: true,
    sourceCommitSha: SHA,
    sourceCommitShaAuthenticated: false,
    codeRevisionVerified: false,
    retailerPermissionVerified: false,
    publicSavingsClaimEligible: false,
  })
  assert.equal(Object.isFrozen(result), true)
  assert.doesNotMatch(JSON.stringify(result), /fake-participant|fake-study|0\.00|fictional test region/)
})

test('M3 pinned study rejects missing, truncated and reordered canonical demand', () => {
  const v = syntheticStudy()
  v.candidate.basket.lines.pop()
  v.candidate.basket.unresolvedLineCount -= 1
  assert.throws(() => evaluate(v), /preflight refused/)
  const swapped = syntheticStudy()
  ;[swapped.baseline.basket.lines[0], swapped.baseline.basket.lines[1]] =
    [swapped.baseline.basket.lines[1], swapped.baseline.basket.lines[0]]
  assert.throws(() => evaluate(swapped), /preflight refused/)
  const changed = syntheticStudy()
  changed.candidate.basket.lines[0].requirement.amount += 1
  assert.throws(() => evaluate(changed), /preflight refused/)
})

test('M3 private preflight denies forged retailer identity and aggregate totals', () => {
  const badStore = syntheticStudy()
  badStore.candidate.basket.store.name = 'Other Supermarket'
  assert.throws(() => evaluate(badStore), /preflight refused/)
  const badTotal = syntheticStudy()
  badTotal.baseline.basket.totalCents = 999
  assert.throws(() => evaluate(badTotal), /preflight refused/)
})

test('M3 private preflight detects altered bytes and ambiguous repeated SHA/claim flags', () => {
  const input = encoded(syntheticStudy())
  const manifest = pinned(input)
  assert.throws(() => preflightPrivateM3Week(Buffer.concat([input, Buffer.from(' ')]), manifest), /preflight refused/)
  const dup = manifest.toString().replace('"sourceCommitSha":', '"sourceCommitSha":"' + 'f'.repeat(40) + '","sourceCommitSha":')
  assert.throws(() => preflightPrivateM3Week(input, Buffer.from(dup)), /preflight refused/)
  const forged = manifest.toString().replace('"publicSavingsClaimEligible":false', '"publicSavingsClaimEligible":true,"publicSavingsClaimEligible":false')
  assert.throws(() => preflightPrivateM3Week(input, Buffer.from(forged)), /preflight refused/)
})

test('M3 private preflight keeps unknown incomplete baskets non-public without invented savings', () => {
  const result = evaluate(syntheticStudy())
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.retailerPermissionVerified, false)
  assert.equal(result.codeRevisionVerified, false)
  assert.equal(result.sourceCommitShaAuthenticated, false)
})

test('M3 private preflight CLI uses only local files and never emits study identifiers or prices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-preflight-'))
  try {
    const study = join(dir, 'private-study.json')
    const pin = join(dir, 'private-pin.json')
    const bytes = encoded(syntheticStudy())
    await writeFile(study, bytes, { mode: 0o600 })
    await writeFile(pin, pinned(bytes), { mode: 0o600 })
    const cmd = ['scripts/m3-verify-private-week-preflight.mjs', study, pin]
    const good = spawnSync(process.execPath, ['--experimental-strip-types', ...cmd], { encoding: 'utf8', timeout: 4000 })
    assert.equal(good.status, 0, good.stderr)
    assert.equal(JSON.parse(good.stdout).privateStudyBytesMatch, true)
    assert.doesNotMatch(good.stdout, /fake-study|fake-participant|synthetic students/)
    const alias = join(dir, 'alias.json')
    await symlink(pin, alias)
    const bad = spawnSync(process.execPath, ['--experimental-strip-types', cmd[0], study, alias], { encoding: 'utf8', timeout: 4000 })
    assert.equal(bad.status, 1)
    assert.equal(bad.stdout, '')
    assert.doesNotMatch(bad.stderr, new RegExp(dir))
    assert.doesNotMatch(bad.stderr, /fake-study|fake-participant/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
