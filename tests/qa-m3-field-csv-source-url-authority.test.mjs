import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBlankM3FieldChecklistCsv } from '../scripts/m3-export-blank-field-checklist.mjs'
import { parseM3FieldCsv, reviewM3FieldCsv } from '../scripts/m3-review-field-csv.mjs'

function fictionalCsvWithUrl(sourceUrl) {
  const rows = parseM3FieldCsv(buildBlankM3FieldChecklistCsv())
  for (const row of rows.slice(1)) {
    row[7] = '2026-10-10T12:00:00Z'
    row[8] = 'in-store'
    row[9] = 'fictional demonstration only'
    row[10] = '500'
    row[11] = 'g'
    row[12] = '1'
    row[13] = '199'
    row[14] = 'ja'
    row[15] = 'manual-cart'
    row[16] = sourceUrl
  }
  return rows.map(row => row.map(cell => '"' +
    String(cell).replaceAll('"', '""') + '"').join(',')).join('\n') + '\n'
}

test('M3 CSV preflight must refuse HTTPS-looking but invalid URL authorities', () => {
  for (const invalid of [
    'https://example.invalid:badport/item',
    'https://example.invalid:99999/item',
    'https://%ZZ.invalid/item',
    'https://[::1/item',
  ]) {
    assert.throws(() => new URL(invalid), undefined, invalid)
    const result = reviewM3FieldCsv(fictionalCsvWithUrl(invalid))
    assert.ok(result.warnings.includes('invalid-source-url'), invalid)
    assert.equal(result.status, 'incomplete-or-needs-review', invalid)
    assert.equal(result.evidenceVerified, false)
    assert.equal(result.releaseEligible, false)
    assert.equal(result.claimable, false)
    assert.equal(result.savingsCents, null)
    assert.doesNotMatch(JSON.stringify(result), /example\.invalid|badport|%ZZ/)
  }
})

test('M3 CSV preflight preserves valid HTTPS URL authority and no-evidence gate', () => {
  for (const valid of [
    'https://example.invalid/item',
    'https://example.invalid:8443/item?listing=synthetic',
    'https://[2001:db8::1]/item',
  ]) {
    assert.equal(new URL(valid).protocol, 'https:')
    const result = reviewM3FieldCsv(fictionalCsvWithUrl(valid))
    assert.deepEqual(result.warnings, [], valid)
    assert.equal(result.completeRows, 22)
    assert.equal(result.status, 'requires-canonical-human-verification')
    assert.equal(result.evidenceVerified, false)
    assert.equal(result.releaseEligible, false)
    assert.equal(result.claimable, false)
    assert.equal(result.savingsCents, null)
  }
})
