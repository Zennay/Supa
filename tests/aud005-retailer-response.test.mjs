import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

import {
  buildPrivacySafeRetailerResponse,
  main,
  validateRetailerResponseRecord,
} from '../scripts/aud005-record-retailer-response.mjs'

function validRecord() {
  return {
    schemaVersion: 1,
    recordType: 'aud005-retailer-response',
    retailer: 'PLUS',
    observedAt: '2026-10-05T06:00:00.000Z',
    channel: 'email',
    respondentTeam: 'e-commerce product data team',
    scope: {
      productContent: true,
      prices: true,
      promotions: true,
      availability: true,
      automation: true,
      storage: true,
    },
    outcome: 'routed',
    responseSummary: 'First-line support routed the pilot request to the team responsible for data permissions.',
    constraints: ['No permission decision was made by first-line support.'],
    nextOwnerTeam: 'commercial data partnerships',
    evidenceRef: 'private-response-plus-2026-10-05-001',
    consequences: {
      architecture: ['Keep production automated reuse disabled until the designated owner responds.'],
      product: [],
      operatingCost: [],
      sourceStrategy: ['Treat the routing response as stakeholder evidence, not permission.'],
    },
  }
}

test('AUD-005 response validator emits privacy-safe bounded evidence', () => {
  const summary = buildPrivacySafeRetailerResponse(validRecord())

  assert.equal(summary.retailer, 'PLUS')
  assert.equal(summary.outcome, 'routed')
  assert.equal(summary.privacySafe, true)
  assert.equal(summary.productionReuseApproved, false)
  assert.equal(summary.publicClaimEligible, false)
  assert.equal(summary.respondentTeam, 'e-commerce product data team')
})

test('AUD-005 response validator accepts explicit permission but keeps scope bounded', () => {
  const record = validRecord()
  record.retailer = 'DekaMarkt'
  record.outcome = 'allowed-with-conditions'
  record.constraints = ['Pilot use only; automated retrieval remains separately restricted.']

  const summary = buildPrivacySafeRetailerResponse(record)
  assert.equal(summary.productionReuseApproved, false)
  assert.equal(summary.productionReuseApprovalStatus, 'requires-explicit-gate-review')
  assert.match(summary.evidenceBoundary, /separate explicit permission gate/i)
})

test('AUD-005 response validator never turns an allowed response into runtime authorization', () => {
  const record = validRecord()
  record.outcome = 'allowed'
  record.constraints = []

  const summary = buildPrivacySafeRetailerResponse(record)
  assert.equal(summary.productionReuseApproved, false)
  assert.equal(summary.productionReuseApprovalStatus, 'requires-explicit-gate-review')
})

test('AUD-005 response validator rejects malformed observation timestamps', () => {
  for (const observedAt of [
    '2026-02-30T06:00:00.000Z',
    '2026-13-05T06:00:00.000Z',
    '2026-10-05T24:00:00.000Z',
    '2026-10-05T06:60:00.000Z',
    '2026-10-05T06:00:60.000Z',
    '2026-10-05T06:00:00.000+24:00',
    '10/05/2026 06:00:00',
  ]) {
    const record = validRecord()
    record.observedAt = observedAt

    assert.throws(
      () => validateRetailerResponseRecord(record),
      /observedAt must be a valid ISO timestamp/,
      observedAt,
    )
  }
})

test('AUD-005 response validator rejects records without a consequence', () => {
  const record = validRecord()
  record.consequences = {
    architecture: [],
    product: [],
    operatingCost: [],
    sourceStrategy: [],
  }

  assert.throws(
    () => validateRetailerResponseRecord(record),
    /at least one architecture\/product\/cost\/source-strategy consequence/,
  )
})

test('AUD-005 response validator rejects direct PII fields', () => {
  const record = validRecord()
  record.email = 'person@example.com'

  assert.throws(
    () => validateRetailerResponseRecord(record),
    /record\.email is not allowed/,
  )
})

test('AUD-005 response validator rejects PII inside evidence references', () => {
  const emailRecord = validRecord()
  emailRecord.evidenceRef = 'private-response-person@example.com'

  assert.throws(
    () => validateRetailerResponseRecord(emailRecord),
    /evidenceRef must not contain an email address/,
  )

  const phoneRecord = validRecord()
  phoneRecord.evidenceRef = 'private-response-+31 20 123 4567'

  assert.throws(
    () => validateRetailerResponseRecord(phoneRecord),
    /evidenceRef must not contain a phone number/,
  )
})

test('AUD-005 response validator rejects email or phone text inside repository-safe fields', () => {
  const emailRecord = validRecord()
  emailRecord.responseSummary = 'Reply from person@example.com approved the pilot.'

  assert.throws(
    () => validateRetailerResponseRecord(emailRecord),
    /must not contain an email address/,
  )

  const phoneRecord = validRecord()
  phoneRecord.nextOwnerTeam = '+31 20 123 4567'

  assert.throws(
    () => validateRetailerResponseRecord(phoneRecord),
    /must not contain a phone number/,
  )
})

test('AUD-005 CLI writes nested privacy-safe output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-aud005-'))
  const input = join(directory, 'input.json')
  const output = join(directory, 'nested', 'response.json')
  await writeFile(input, JSON.stringify(validRecord()), 'utf8')

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/aud005-record-retailer-response.mjs', input, '--output', output],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `CLI exited with ${code}`))
      else resolve(code)
    })
  })

  assert.equal(exitCode, 0)
  const report = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(report.privacySafe, true)
  assert.equal(report.evidenceRef, 'private-response-plus-2026-10-05-001')
})


test('AUD-005 CLI preserves an existing privacy-safe output byte-for-byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-aud005-no-clobber-'))
  const input = join(directory, 'input.json')
  const output = join(directory, 'response.json')
  const existing = '{"existing":"stakeholder evidence"}\n'

  await Promise.all([
    writeFile(input, JSON.stringify(validRecord()), 'utf8'),
    writeFile(output, existing, 'utf8'),
  ])

  await assert.rejects(
    () => main([input, '--output', output]),
    (error) => error?.code === 'EEXIST',
  )

  assert.equal(await readFile(output, 'utf8'), existing)
})


test('AUD-005 CLI rejects malformed output arguments before emitting evidence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-aud005-output-args-'))
  const input = join(directory, 'input.json')
  await writeFile(input, JSON.stringify(validRecord()), 'utf8')

  await assert.rejects(
    () => main([input, '--output']),
    /--output requires a file path/,
  )
  await assert.rejects(
    () => main([input, '--output', '--unexpected']),
    /--output requires a file path/,
  )
  await assert.rejects(
    () =>
      main([
        input,
        '--output',
        join(directory, 'first.json'),
        '--output',
        join(directory, 'second.json'),
      ]),
    /--output may only be specified once/,
  )
})
