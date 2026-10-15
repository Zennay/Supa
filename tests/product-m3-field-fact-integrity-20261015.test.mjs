import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { buildM3OutstandingFieldActions } from '../scripts/m3-private-outstanding-field-actions.mjs'

const CLI = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const NOW = Date.parse('2026-10-15T12:00:00Z')
const secret = 'PRIVATE_OPERATOR_SOURCE_IDENTIFIER_DO_NOT_ECHO'
const count = raw => buildM3OutstandingFieldActions(JSON.stringify(raw), NOW)

function fixture() {
  const sheet = buildObservationSheet()
  sheet.study.participantKey = 'fictional_participant'
  sheet.baseline.provenanceNote = secret
  sheet.baseline.lines[0].observedProduct = {
    available: true,
    productId: 'fictional_sku',
    productName: 'fictional product',
    packAmount: 500,
    packUnit: 'g',
    packCount: 2,
    priceCents: 379,
    sourceUrl: '',
    note: secret,
  }
  return sheet
}

test('actual positive whole-pack counts remain truthful in operator report', () => {
  const sheet = fixture()
  for (const n of [1, 2, 9]) {
    sheet.baseline.lines[0].observedProduct.packCount = n
    const report = count(sheet)
    assert.equal(report.retailers[0].completedLines, 1)
    assert.equal(report.remainingTotalLines, 21)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
})

test('unsupported or missing retailer source must not be repaired to manual-cart by operator', () => {
  for (const field of ['unexpected-source', '', null, undefined, 3, true]) {
    for (const side of ['baseline', 'candidate']) {
      const sheet = fixture()
      if (field === undefined) delete sheet[side].source
      else sheet[side].source = field
      assert.throws(() => count(sheet), /invalid observation source/)
    }
  }
})

test('invalid available packCount never silently becomes the restorer default of one pack', () => {
  for (const n of [0, -1, 1.5, 1e100, '2', null, undefined]) {
    const sheet = fixture()
    if (n === undefined) delete sheet.baseline.lines[0].observedProduct.packCount
    else sheet.baseline.lines[0].observedProduct.packCount = n
    assert.throws(() => count(sheet), /invalid observed pack count/)
  }
})

test('unavailable physical row remains complete without inventing a product', () => {
  const sheet = fixture()
  sheet.baseline.lines[0].observedProduct = {
    ...buildObservationSheet().baseline.lines[0].observedProduct,
    available: false,
    packCount: 0,
  }
  const result = count(sheet)
  assert.equal(result.retailers[0].completedLines, 1)
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(result.publicSavingsClaimEligible, false)
})

test('explicitly unavailable original must not hide a contradictory priced product', () => {
  const values = [
    ['productName', 'PRIVATE_STALE_PRODUCT'],
    ['productId', 'PRIVATE_STALE_PRODUCT_ID'],
    ['packAmount', 500],
    ['packUnit', 'g'],
    ['priceCents', 0],
    ['priceCents', 599],
  ]
  for (const side of ['baseline', 'candidate']) {
    for (const [key, value] of values) {
      const sheet = fixture()
      const line = sheet[side].lines[0]
      line.observedProduct = {
        ...buildObservationSheet()[side].lines[0].observedProduct,
        available: false,
      }
      line.observedProduct[key] = value
      assert.throws(() => count(sheet), /contradicts observed unavailability/,
        'refuse ' + side + ' unavailable with ' + key)
    }
  }
})

test('unavailable row may retain a privacy-safe explanation note but no invented price', () => {
  const sheet = fixture()
  sheet.baseline.lines[0].observedProduct = {
    ...buildObservationSheet().baseline.lines[0].observedProduct,
    available: false,
  }
  sheet.baseline.lines[0].observedProduct.note = secret
  sheet.baseline.lines[0].observedProduct.sourceUrl = 'https://example.invalid/PRIVATE_PATH'
  sheet.candidate.lines[0].observedProduct.available = false
  sheet.candidate.lines[0].observedProduct.note = secret
  const result = count(sheet)
  assert.equal(result.completedTotalLines, 2)
  assert.equal(result.remainingTotalLines, 20)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.verifiedRetailerObservations, false)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(result).includes('PRIVATE_PATH'), false)
})

test('malformed original fields refuse CLI JSON/text without leaking path or source', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-refuse-restored-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'PERSONAL-PRIVATE-DRAFT.json')
  const sheet = fixture()
  for (const variant of ['invalid-source', 'invalid-packcount']) {
    if (variant === 'invalid-source') sheet.baseline.source = 'CUSTOMER_SECRET_FORGED'
    else {
      sheet.baseline.source = 'manual-cart'
      sheet.baseline.lines[0].observedProduct.packCount = 0
    }
    const input = JSON.stringify(sheet)
    await writeFile(path, input, { mode: 0o600 })
    for (const flags of [[], ['--text'], ['--text', '--store', 'plus']]) {
      const result = spawnSync(process.execPath,
        ['--experimental-strip-types', CLI, path, ...flags],
        { cwd: dir, encoding: 'utf8', timeout: 20_000 })
      assert.equal(result.error, undefined, result.error?.message)
      assert.notEqual(result.status, 0)
      assert.equal(result.stdout, '')
      assert.equal(result.stderr.includes(secret), false)
      assert.equal(result.stderr.includes('CUSTOMER_SECRET_FORGED'), false)
      assert.equal(result.stderr.includes(path), false)
    }
    assert.equal(await readFile(path, 'utf8'), input)
  }
})
