import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week, assertUnambiguousM3StudyJson } from '../scripts/m3-verify-private-week-preflight.mjs'
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

test('M3 preflight rejects oversized, malformed UTF-8 and malformed manifest byte envelopes', () => {
  const input = encoded(syntheticStudy())
  const pin = pinned(input)
  assert.throws(() => preflightPrivateM3Week(Buffer.alloc(4 * 1024 * 1024 + 1), pin), /preflight refused/)
  assert.throws(() => preflightPrivateM3Week(input, Buffer.alloc(4097)), /preflight refused/)
  assert.throws(() => preflightPrivateM3Week(Buffer.from([0xff]), pin), /preflight refused/)
  assert.throws(() => preflightPrivateM3Week(input, Buffer.from([0xff])), /preflight refused/)
  assert.throws(() => preflightPrivateM3Week(input, Buffer.from('{"sourceCommitSha":"x"}')), /preflight refused/)
})

test('M3 private weekly CLI refuses nonblocking Linux FIFO for either input without emitting data', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux mkfifo gate')
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-week-fifo-'))
  try {
    const study = join(dir, 'study.json')
    const pin = join(dir, 'pin.json')
    const fifo = join(dir, 'untrusted-pipe')
    const bytes = encoded(syntheticStudy())
    await writeFile(study, bytes, { mode: 0o600 })
    await writeFile(pin, pinned(bytes), { mode: 0o600 })
    const make = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 2500 })
    assert.equal(make.status, 0, make.stderr)
    for (const args of [[fifo, pin], [study, fifo]]) {
      const proc = spawnSync(process.execPath, ['--experimental-strip-types',
        'scripts/m3-verify-private-week-preflight.mjs', ...args], {
        encoding: 'utf8', timeout: 3000,
      })
      assert.equal(proc.error, undefined, String(proc.error))
      assert.equal(proc.status, 1, proc.stderr)
      assert.equal(proc.stdout, '')
      assert.doesNotMatch(proc.stderr, new RegExp(dir))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 pinned weekly preflight rejects >24h, out-of-plan-week and future captures', () => {
  const tooFar = syntheticStudy()
  tooFar.candidate.observedAt = '2026-10-16T12:00:00Z'
  assert.throws(() => evaluate(tooFar), /preflight refused/)
  const wrongWeek = syntheticStudy()
  wrongWeek.weekStart = '2026-10-01'
  assert.throws(() => evaluate(wrongWeek), /preflight refused/)
  const future = syntheticStudy()
  future.weekStart = '2035-10-15'
  future.baseline.observedAt = '2035-10-15T09:00:00Z'
  future.candidate.observedAt = '2035-10-15T11:00:00Z'
  assert.throws(() => evaluate(future), /preflight refused/)
  const invalidWeekDate = syntheticStudy()
  invalidWeekDate.weekStart = '2026-10-32'
  assert.throws(() => evaluate(invalidWeekDate), /preflight refused/)
})

test('M3 strict study JSON detects double identity and nested price or demand attestation', () => {
  const raw = encoded(syntheticStudy()).toString('utf8')
  const cases = [
    raw.replace('"studyId":', '"studyId":"forged-identity","studyId":'),
    raw.replace('"amount":', '"amount":99999,"amount":'),
    raw.replace('"totalCents":', '"totalCents":99999,"totalCents":'),
    raw.replace('"studyId":', '"st\\u0075dyId":"hidden-identity","studyId":'),
  ]
  for (const ambiguous of cases) {
    // JSON.parse last-wins would otherwise produce the *normal* fixture.
    assert.equal(JSON.parse(ambiguous).studyId, syntheticStudy().studyId)
    const studyBytes = Buffer.from(ambiguous)
    const properDigest = pinned(studyBytes)
    assert.throws(() => preflightPrivateM3Week(studyBytes, properDigest), /preflight refused/)
  }
})

test('M3 strict JSON scanner supports nested valid literals, escaped strings and refuses malformed shapes', () => {
  const value = '{"a":{"x":[null,true,false,1.5e2,"escaped\\\\quote"]},"b":2}'
  assert.doesNotThrow(() => assertUnambiguousM3StudyJson(value))
  for (const hostile of [
    '{"a":1,"a":2}',
    '{"a":1,}',
    '[{"x":1,"x":2}]',
    '{"x":[1,2,]}',
    '{"x":"unterminated}',
    '{"x":01}',
    '{"x":true} extra',
  ]) {
    assert.throws(() => assertUnambiguousM3StudyJson(hostile), /preflight refused/)
  }
})
