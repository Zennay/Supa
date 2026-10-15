import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildWeeklyBasketStudyFromObservationSheet } from '../scripts/m3-build-observed-study.mjs'
import { createPrivateM3StudyCodePin } from '../scripts/m3-field-code-pin.mjs'
import { preflightPrivateM3Week } from '../scripts/m3-verify-private-week-preflight.mjs'
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
  assert.equal(result.plusCompleteLineCount, 0)
  assert.equal(result.dekamarktCompleteLineCount, 0)
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
  assert.equal(progress.plusCompleteLineCount, 11)
  assert.equal(progress.dekamarktCompleteLineCount, 10)
  assert.equal(progress.plusAvailabilityRecorded, 11)
  assert.equal(progress.dekamarktAvailabilityRecorded, 10)
  assert.equal(progress.technicalStudyConversionPossible, false)
  assert.equal(progress.nextAction, 'complete-dekamarkt-observations')
  assertPrivateFlags(progress)
})

test('M3 private field readiness runs REAL converter and strict preflight for completed fictional 11x11', () => {
  const result = reviewPrivateM3FieldSheet(bytes(syntheticFullSheet()), SHA)
  assert.equal(result.canonicalLineCount, 22)
  assert.equal(result.completeObservationLineCount, 22)
  assert.equal(result.plusCompleteLineCount, 11)
  assert.equal(result.dekamarktCompleteLineCount, 11)
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

test('M3 operator next action differentiates PLUS from DekaMarkt without showing product/participant', () => {
  const s = syntheticFullSheet()
  s.baseline.lines[5].observedProduct.available = null
  const result = reviewPrivateM3FieldSheet(bytes(s), SHA)
  assert.equal(result.plusCompleteLineCount, 10)
  assert.equal(result.dekamarktCompleteLineCount, 11)
  assert.equal(result.nextAction, 'complete-plus-observations')
  assert.equal(result.technicalStudyConversionPossible, false)
  assertPrivateFlags(result)
  assert.doesNotMatch(JSON.stringify(result), /fictional|productName|priceCents/)
})

test('M3 private CLI also rejects symlinked ancestor directories, not just final aliases', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-ancestor-'))
  try {
    const real = join(dir, 'actual')
    await mkdir(real)
    const privateSheet = join(real, 'sheet.json')
    await writeFile(privateSheet, bytes(syntheticFullSheet()), { mode: 0o600 })
    const ancestorAlias = join(dir, 'linked-parent')
    await symlink(real, ancestorAlias)
    const proc = spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-private-field-readiness.mjs',
      join(ancestorAlias, 'sheet.json'), '--expect-main-sha', SHA,
    ], { encoding: 'utf8', timeout: 7000 })
    assert.equal(proc.error, undefined, String(proc.error))
    assert.equal(proc.status, 1)
    assert.equal(proc.stdout, '')
    assert.equal(proc.stderr.trim(), 'Private M3 field readiness refused')
    assert.doesNotMatch(proc.stderr, /linked-parent|sheet\.json|fictional/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('M3 technically complete preview must not normalize away a forged original 24-hour contract', () => {
  const tampered = syntheticFullSheet()
  tampered.study.maxObservationWindowHours = 120
  // Draft normalization can reset this to 24, but original converter MUST
  // reject the actual user-provided source, even when all 22 rows look done.
  assert.throws(
    () => reviewPrivateM3FieldSheet(bytes(tampered), SHA),
    (error) => error.message === 'Private M3 field readiness refused',
  )
  const malformed = syntheticFullSheet()
  malformed.study.maxObservationWindowHours = null
  assert.throws(() => reviewPrivateM3FieldSheet(bytes(malformed), SHA), /readiness refused/)
  assert.equal(
    reviewPrivateM3FieldSheet(bytes(syntheticFullSheet()), SHA).technicalStudyConversionPossible,
    true,
  )
})

test('private SHA-bound M3 preflight rejects invisible-only source context while unresolved 11x11 remains admissible', () => {
  const original = buildWeeklyBasketStudyFromObservationSheet(syntheticFullSheet())
  const proof = (study) => {
    const studyBytes = bytes(study)
    const pinBytes = bytes(createPrivateM3StudyCodePin(studyBytes, SHA))
    return preflightPrivateM3Week(studyBytes, pinBytes, SHA)
  }
  const valid = proof(original)
  assert.equal(valid.status, 'private-review-only')
  assert.equal(valid.publicSavingsClaimEligible, false)
  assert.equal(valid.canonicalDemandLineCount, 11)

  for (const [side, field] of [
    [null, 'population'], [null, 'region'],
    ['baseline', 'provenanceNote'], ['candidate', 'provenanceNote'],
  ]) {
    const study = structuredClone(original)
    const owner = side === null ? study : study[side]
    owner[field] = String.fromCodePoint(0x200b, 0x2060, 0x0301)
    assert.throws(() => proof(study), /M3 private study provenance preflight refused/)
  }
})

test('M3 missing-field checklist identifies all sixteen fixed metadata keys and all 22 canonical positions', () => {
  const x = reviewPrivateM3FieldSheet(bytes(blank()), SHA)
  assert.equal(x.missingMetadataFieldKeys.length, 16)
  assert.deepEqual(x.plusMissingLineNumbers, [1,2,3,4,5,6,7,8,9,10,11])
  assert.deepEqual(x.dekamarktMissingLineNumbers, [1,2,3,4,5,6,7,8,9,10,11])
  assert.equal(x.nextMissingMetadataFieldKey, 'study.studyId')
  assert.equal(x.nextMissingPlusLineNumber, 1)
  assert.equal(x.nextMissingDekaLineNumber, 1)
  assert.equal(x.missingMetadataFieldKeys[5], 'study.priceContext')
  assert.equal(x.missingMetadataFieldKeys[8], 'baseline.provenanceNote')
  assert.equal(x.missingMetadataFieldKeys[13], 'candidate.provenanceNote')
  assert.equal(Object.isFrozen(x.missingMetadataFieldKeys), true)
  assert.equal(Object.isFrozen(x.plusMissingLineNumbers), true)
  assert.equal(Object.isFrozen(x.dekamarktMissingLineNumbers), true)
  assertPrivateFlags(x)
})

test('M3 field checklist reports only stable keys and positions for partially completed private evidence', () => {
  const s = syntheticFullSheet()
  s.study.population = '\u200b\u2060'
  s.baseline.provenanceNote = '\u0301'
  s.baseline.lines[3].observedProduct.available = null
  s.candidate.lines[8].observedProduct.available = null
  const x = reviewPrivateM3FieldSheet(bytes(s), SHA)
  assert.deepEqual(x.missingMetadataFieldKeys, [
    'study.population', 'baseline.provenanceNote',
  ])
  assert.deepEqual(x.plusMissingLineNumbers, [4])
  assert.deepEqual(x.dekamarktMissingLineNumbers, [9])
  assert.equal(x.nextMissingMetadataFieldKey, 'study.population')
  assert.equal(x.nextMissingPlusLineNumber, 4)
  assert.equal(x.nextMissingDekaLineNumber, 9)
  assert.equal(x.completeObservationLineCount, 20)
  assert.equal(x.technicalStudyConversionPossible, false)
  assert.equal(x.nextAction, 'complete-private-study-metadata')
  assert.doesNotMatch(JSON.stringify(x), /fictional-person-key|fictional region|fabricated test|\u200b|\u2060|\u0301|priceCents/)
  assertPrivateFlags(x)
})

test('M3 complete synthetically unavailable field week has empty, immutable next-field checklist', () => {
  const x = reviewPrivateM3FieldSheet(bytes(syntheticFullSheet()), SHA)
  assert.deepEqual(x.missingMetadataFieldKeys, [])
  assert.deepEqual(x.plusMissingLineNumbers, [])
  assert.deepEqual(x.dekamarktMissingLineNumbers, [])
  assert.equal(x.nextMissingMetadataFieldKey, null)
  assert.equal(x.nextMissingPlusLineNumber, null)
  assert.equal(x.nextMissingDekaLineNumber, null)
  assert.equal(x.technicalStudyConversionPossible, true)
  assert.equal(x.publicSavingsClaimEligible, false)
  assert.equal(x.fieldObservationVerified, false)
})

test('M3 pinned-week CLI refuses symlinked ancestor for both private study and SHA sidecar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-preflight-parents-'))
  try {
    const actual = join(dir, 'private-origin')
    await mkdir(actual)
    const studyBytes = bytes(buildWeeklyBasketStudyFromObservationSheet(syntheticFullSheet()))
    const pinBytes = bytes(createPrivateM3StudyCodePin(studyBytes, SHA))
    const study = join(actual, 'study.json')
    const pin = join(actual, 'manifest.json')
    await writeFile(study, studyBytes, { mode: 0o600 })
    await writeFile(pin, pinBytes, { mode: 0o600 })
    const command = (sourceStudy, sourcePin) => spawnSync(process.execPath, [
      '--experimental-strip-types', 'scripts/m3-verify-private-week-preflight.mjs',
      sourceStudy, sourcePin, '--expect-main-sha', SHA,
    ], { encoding: 'utf8', timeout: 7000 })
    const healthy = command(study, pin)
    assert.equal(healthy.error, undefined, String(healthy.error))
    assert.equal(healthy.status, 0, healthy.stderr)
    assert.equal(JSON.parse(healthy.stdout).publicSavingsClaimEligible, false)
    const alias = join(dir, 'unsafe-parent-link')
    await symlink(actual, alias)
    for (const [studyPath, pinPath] of [
      [join(alias, 'study.json'), pin],
      [study, join(alias, 'manifest.json')],
    ]) {
      const denied = command(studyPath, pinPath)
      assert.equal(denied.error, undefined, String(denied.error))
      assert.equal(denied.status, 1)
      assert.equal(denied.stdout, '')
      assert.equal(denied.stderr.trim(), 'M3 private study provenance preflight refused')
      assert.doesNotMatch(denied.stderr, /private-origin|unsafe-parent-link|manifest\.json|study\.json/)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
