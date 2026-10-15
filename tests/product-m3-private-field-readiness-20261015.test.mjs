import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  reviewPrivateM3FieldSheet,
  main as fieldReviewMain,
} from '../scripts/m3-private-field-readiness.mjs'

const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const bytes = value => Buffer.from(JSON.stringify(value))
const blank = () => buildObservationSheet()
function syntheticFullSheet() {
  const s = blank()
  Object.assign(s.study, {
    studyId: 'fictional-m3-study',
    participantKey: 'fictional-person-key',
    population: 'synthetic students, not real evidence',
    region: 'fictional region',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [side, observedAt, brand] of [
    ['baseline', '2026-10-14T11:00:00Z', 'PLUS'],
    ['candidate', '2026-10-14T12:00:00Z', 'DekaMarkt'],
  ]) {
    const store = s[side]
    store.evidenceId = 'synthetic-' + side
    store.observedAt = observedAt
    store.source = 'manual-cart'
    store.provenanceNote = 'fabricated test data only'
    store.store.id = side + '-fictional'
    store.store.name = brand
    // Unavailable is a valid observation state, but NOT a resolved basket.
    for (const line of store.lines) line.observedProduct.available = false
  }
  return s
}
function assertPrivateFlags(x) {
  for (const f of [
    'fieldObservationVerified', 'sourceCommitShaAuthenticated',
    'codeRevisionVerified', 'retailerPermissionVerified',
    'publicSavingsClaimEligible',
  ]) assert.equal(x[f], false, f)
  assert.equal(x.status, 'private-tooling-only')
}

test('M3 private field readiness turns a fresh planner template into privacy-safe actionable progress', () => {
  const result = reviewPrivateM3FieldSheet(bytes(blank()), SHA)
  assert.equal(result.canonicalLineCount, 22)
  assert.equal(result.completeObservationLineCount, 0)
  assert.equal(result.recordedAvailabilityCount, 0)
  assert.equal(result.technicalStudyConversionPossible, false)
  assert.equal(result.nextAction, 'complete-private-study-metadata')
  assert.equal(result.baselineUnresolvedLineCount, null)
  assertPrivateFlags(result)
  assert.equal(Object.isFrozen(result), true)
})

test('M3 private field readiness identifies missing lines without inventing verified baskets', () => {
  const s = syntheticFullSheet()
  s.candidate.lines[0].observedProduct.available = null
  const progress = reviewPrivateM3FieldSheet(bytes(s), SHA)
  assert.equal(progress.recordedAvailabilityCount, 21)
  assert.equal(progress.completeObservationLineCount, 21)
  assert.equal(progress.technicalStudyConversionPossible, false)
  assert.equal(progress.nextAction, 'complete-remaining-store-observations')
  assertPrivateFlags(progress)
})

test('M3 private field readiness runs REAL converter and strict preflight for completed fictional 11x11', () => {
  const result = reviewPrivateM3FieldSheet(bytes(syntheticFullSheet()), SHA)
  assert.equal(result.canonicalLineCount, 22)
  assert.equal(result.completeObservationLineCount, 22)
  assert.equal(result.recordedAvailabilityCount, 22)
  assert.equal(result.metadataCompleteCount, result.metadataRequiredCount)
  assert.equal(result.technicalStudyConversionPossible, true)
  assert.equal(result.baselineUnresolvedLineCount, 11)
  assert.equal(result.candidateUnresolvedLineCount, 11)
  assert.equal(result.nextAction, 'review-unavailable-or-unmatched-products')
  assertPrivateFlags(result)
  const safe = JSON.stringify(result)
  assert.doesNotMatch(safe, /fictional-person-key|fictional region|fabricated test data|priceCents|sourceUrl/)
  assert.doesNotMatch(safe, /abcdef1234567890/)
})

test('M3 private field readiness fails closed on source version, swapped demand and contradictory raw JSON', () => {
  const input = bytes(syntheticFullSheet())
  for (const badSha of [undefined, null, '', '0'.repeat(40), SHA.toUpperCase(), 'x'.repeat(40)]) {
    assert.throws(
      () => reviewPrivateM3FieldSheet(input, badSha),
      /Private M3 field readiness refused/,
    )
  }
  const tampered = syntheticFullSheet()
  tampered.requirements[0].amount += 50
  assert.throws(
    () => reviewPrivateM3FieldSheet(bytes(tampered), SHA),
    /Private M3 field readiness refused/,
  )
  const raw = input.toString()
  const duplicate = raw.replace('"priceContext":', '"priceContext":"online-order","priceContext":')
  assert.doesNotThrow(() => JSON.parse(duplicate))
  assert.throws(
    () => reviewPrivateM3FieldSheet(Buffer.from(duplicate), SHA),
    /Private M3 field readiness refused/,
  )
  assert.throws(() => reviewPrivateM3FieldSheet(Buffer.from([0xff]), SHA), /readiness refused/)
  assert.throws(() => reviewPrivateM3FieldSheet(Buffer.alloc(4 * 1024 * 1024 + 1), SHA), /readiness refused/)
})

test('M3 local operator CLI has no network, private file writes, or participant/price stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-field-review-'))
  try {
    const path = join(dir, 'synthetic-private-sheet.json')
    await writeFile(path, bytes(syntheticFullSheet()), { mode: 0o600 })
    const command = ['--experimental-strip-types', 'scripts/m3-private-field-readiness.mjs', path]
    const good = spawnSync(process.execPath, [...command, '--expect-main-sha', SHA], {
      encoding: 'utf8', timeout: 7000,
    })
    assert.equal(good.error, undefined, String(good.error))
    assert.equal(good.status, 0, good.stderr)
    assert.equal(JSON.parse(good.stdout).technicalStudyConversionPossible, true)
    assert.doesNotMatch(good.stdout, /fictional-|fabricated|students|private-sheet|price|sourceUrl|abcde/)
    assert.equal(good.stderr, '')
    for (const args of [[], ['--expect-main-sha'], ['--expect-main-sha', 'x'], ['--expect-main-sha', SHA, 'extra']]) {
      const fail = spawnSync(process.execPath, [...command, ...args], { encoding: 'utf8', timeout: 7000 })
      assert.equal(fail.error, undefined, String(fail.error))
      assert.equal(fail.status, 1)
      assert.equal(fail.stdout, '')
      assert.equal(fail.stderr.trim(), 'Private M3 field readiness refused')
      assert.doesNotMatch(fail.stderr, /private-sheet|fictional|price|\/tmp\//)
    }
    const alias = join(dir, 'symlink.json')
    await symlink(path, alias)
    const linkFail = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-private-field-readiness.mjs',
      alias, '--expect-main-sha', SHA,
    ], { encoding: 'utf8', timeout: 7000 })
    assert.equal(linkFail.status, 1)
    assert.equal(linkFail.stdout, '')
    // Calling the exported API with omitted argv is never a valid fallback.
    await assert.rejects(() => fieldReviewMain([path, '--expect-main-sha', undefined]), /readiness refused/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 private readiness CLI does not block on named pipes with untrusted sheet source', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only FIFO trust boundary')
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-field-fifo-'))
  try {
    const fifo = join(dir, 'pipe')
    const make = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 3000 })
    assert.equal(make.status, 0, make.stderr)
    const proc = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-private-field-readiness.mjs',
      fifo, '--expect-main-sha', SHA,
    ], { encoding: 'utf8', timeout: 7000 })
    assert.equal(proc.error, undefined, String(proc.error))
    assert.equal(proc.status, 1)
    assert.equal(proc.stdout, '')
    assert.equal(proc.stderr.trim(), 'Private M3 field readiness refused')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
