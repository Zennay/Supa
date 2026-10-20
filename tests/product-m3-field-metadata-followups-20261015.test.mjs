import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const CLI = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const privateMarker = 'PRIVATE_CUSTOMER_ADDRESS_DO_NOT_ECHO'

function fictionalCompleteMetadata() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'fictional_m3_study',
    participantKey: 'fictional_m3_participant',
    population: privateMarker,
    region: 'fictional-city',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  sheet.baseline.evidenceId = 'fictional_plus_evidence'
  sheet.baseline.observedAt = '2026-10-14T10:00:00Z'
  sheet.baseline.provenanceNote = privateMarker
  sheet.baseline.store.id = 'fictional_plus_store'
  sheet.baseline.store.name = 'PLUS fictional'
  sheet.candidate.evidenceId = 'fictional_deka_evidence'
  sheet.candidate.observedAt = '2026-10-14T10:30:00Z'
  sheet.candidate.provenanceNote = privateMarker
  sheet.candidate.store.id = 'fictional_deka_store'
  sheet.candidate.store.name = 'DekaMarkt fictional'
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  return sheet
}

const collect = sheet => buildM3OutstandingFieldActions(JSON.stringify(sheet), NOW)
const fields = rows => rows.map(row => row.field)

test('blank canonical M3 draft explains 16 missing metadata fields and 22 genuine line tasks', () => {
  const report = collect(buildObservationSheet())
  assert.deepEqual(fields(report.pendingMetadata.study), [
    'studyId', 'participantKey', 'population', 'region', 'weekStart', 'priceContext',
  ])
  assert.deepEqual(fields(report.pendingMetadata.plus), [
    'storeName', 'storeId', 'evidenceId', 'provenanceNote', 'observedAt',
  ])
  assert.deepEqual(fields(report.pendingMetadata.dekamarkt), [
    'storeName', 'storeId', 'evidenceId', 'provenanceNote', 'observedAt',
  ])
  assert.equal(report.pendingMetadataCount, 16)
  assert.equal(report.remainingTotalLines, 22)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.verifiedRetailerObservations, false)
})

test('valid fictional 22-line metadata gives no false outstanding tasks but never verifies retailer evidence', () => {
  const sheet = fictionalCompleteMetadata()
  const before = JSON.stringify(sheet)
  const report = collect(sheet)
  assert.equal(report.pendingMetadataCount, 0)
  assert.deepEqual(report.pendingMetadata, { study: [], plus: [], dekamarkt: [] })
  assert.equal(report.remainingTotalLines, 0)
  assert.equal(report.readyForPrivateReview, true)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(sheet), before)
  assert.equal(JSON.stringify(report).includes(privateMarker), false)
})

test('invalid pseudonymous study key, invalid week, wrong retailer and future clock become fixed actions', () => {
  const sheet = fictionalCompleteMetadata()
  sheet.study.studyId = 'PERSONAL-RAW-DONT-ECHO@example.invalid'
  sheet.study.weekStart = '2026-02-30'
  sheet.baseline.store.name = 'Unknown retailer PERSONAL-RAW-DONT-ECHO'
  sheet.candidate.observedAt = '2099-10-14T11:00:00Z'
  const report = collect(sheet)
  assert.deepEqual(fields(report.pendingMetadata.study), ['studyId', 'weekStart', 'observationWindow'])
  assert.deepEqual(fields(report.pendingMetadata.plus), ['storeName'])
  assert.deepEqual(fields(report.pendingMetadata.dekamarkt), ['observedAt'])
  assert.equal(report.pendingMetadataCount, 5)
  assert.equal(report.observationWindowExpired, true)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(JSON.stringify(report).includes('PERSONAL-RAW-DONT-ECHO'), false)
  assert.equal(JSON.stringify(report).includes('2099'), false)
})

test('duplicate private physical and evidence IDs cannot masquerade as independent store visits', () => {
  const sheet = fictionalCompleteMetadata()
  sheet.candidate.store.id = sheet.baseline.store.id
  sheet.candidate.evidenceId = sheet.baseline.evidenceId
  const report = collect(sheet)
  assert.deepEqual(fields(report.pendingMetadata.plus), ['distinctStoreId', 'distinctEvidenceId'])
  assert.deepEqual(fields(report.pendingMetadata.dekamarkt), ['distinctStoreId', 'distinctEvidenceId'])
  assert.equal(report.pendingMetadataCount, 4)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(JSON.stringify(report).includes('fictional_plus_store'), false)
})

test('true >24-hour separation produces remeasurement action without private dates or dollars', () => {
  const sheet = fictionalCompleteMetadata()
  sheet.candidate.observedAt = '2026-10-15T11:00:00Z'
  const report = collect(sheet)
  assert.equal(report.observationWindowState, 'outside-window')
  assert.deepEqual(fields(report.pendingMetadata.study), ['observationWindow'])
  assert.equal(report.pendingMetadataCount, 1)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(JSON.stringify(report).includes('2026-10-15T11:00:00Z'), false)
})

test('different private participant, store, and evidence names never affect identical metadata actions', () => {
  const alpha = fictionalCompleteMetadata()
  const beta = fictionalCompleteMetadata()
  alpha.baseline.evidenceId = ''
  beta.baseline.evidenceId = ''
  alpha.study.population = 'PERSONAL_ALICE_PRIVATE'
  beta.study.population = 'PERSONAL_BOB_PRIVATE'
  alpha.baseline.store.id = 'first_private_store'
  beta.baseline.store.id = 'second_private_store'
  alpha.baseline.provenanceNote = 'alice-private-receipt-note'
  beta.baseline.provenanceNote = 'bob-private-receipt-note'
  const left = collect(alpha)
  const right = collect(beta)
  assert.deepEqual(left, right)
  assert.deepEqual(fields(left.pendingMetadata.plus), ['evidenceId'])
  for (const marker of ['ALICE','BOB','alice','bob']) {
    assert.equal(JSON.stringify(left).includes(marker), false)
  }
})

test('CLI retailer-only text shows common study + selected-store follow-ups, never the other store', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-metadata-followup-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'private.json')
  const sheet = fictionalCompleteMetadata()
  sheet.study.weekStart = ''
  sheet.baseline.store.name = ''
  sheet.candidate.provenanceNote = ''
  const original = JSON.stringify(sheet)
  await writeFile(path, original, { mode: 0o600 })
  for (const [store, expected, forbidden] of [
    ['plus', 'Juiste winkelnaam', 'Herkomstnotitie'],
    ['dekamarkt', 'Herkomstnotitie', 'Juiste winkelnaam'],
  ]) {
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', CLI, path, '--text', '--store', store],
      { cwd: dir, encoding: 'utf8', timeout: 20_000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Begindatum van de week/)
    assert.match(result.stdout, new RegExp(expected))
    assert.equal(result.stdout.includes(forbidden), false)
    assert.equal(result.stdout.includes(privateMarker), false)
    assert.equal(result.stdout.includes(dir), false)
    assert.equal(result.stderr, '')
  }
  assert.equal(await readFile(path, 'utf8'), original)
})

test('available product rows identify exact missing fields without disclosing observed product data', async t => {
  const sheet = fictionalCompleteMetadata()
  sheet.baseline.lines[0].observedProduct = {
    productId: 'private_sku', productName: 'PRIVATE_PRODUCT_NAME_AND_PRICE',
    packAmount: 450, packUnit: 'g', packCount: 1,
    priceCents: null, available: true, sourceUrl: '', note: '',
  }
  sheet.candidate.lines[0].observedProduct = {
    productId: '', productName: '\u2800',
    packAmount: 0, packUnit: 'unknown', packCount: 1,
    priceCents: null, available: true, sourceUrl: '', note: '',
  }
  const report = collect(sheet)
  assert.deepEqual(report.retailers[0].pending[0].missingFields, ['priceCents'])
  assert.deepEqual(report.retailers[1].pending[0].missingFields, [
    'productName', 'packAmount', 'packUnit', 'priceCents',
  ])
  assert.equal(report.remainingTotalLines, 2)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(JSON.stringify(report).includes('PRIVATE_PRODUCT_NAME_AND_PRICE'), false)

  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-operator-hint-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'fictional.json')
  await writeFile(path, JSON.stringify(sheet), { mode: 0o600 })
  const plus = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, path, '--text', '--store', 'plus'],
    { cwd: dir, encoding: 'utf8', timeout: 20_000 })
  const deka = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, path, '--text', '--store', 'dekamarkt'],
    { cwd: dir, encoding: 'utf8', timeout: 20_000 })
  assert.equal(plus.status, 0, plus.stderr)
  assert.equal(deka.status, 0, deka.stderr)
  assert.match(plus.stdout, /nog nodig: Prijs per verpakking/)
  assert.doesNotMatch(plus.stdout, /nog nodig: Productnaam/)
  assert.match(deka.stdout, /nog nodig: Productnaam, Verpakkingshoeveelheid, Verpakkingseenheid, Prijs per verpakking/)
  for (const view of [plus.stdout, deka.stdout]) {
    assert.equal(view.includes('PRIVATE_PRODUCT_NAME_AND_PRICE'), false)
    assert.equal(view.includes(privateMarker), false)
  }
});
