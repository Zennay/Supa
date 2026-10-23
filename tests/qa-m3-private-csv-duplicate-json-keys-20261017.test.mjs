import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { buildPrivateM3ProductComparison } from '../scripts/m3-private-product-comparison.mjs'
import { renderPrivateM3ComparisonCsv } from '../scripts/m3-private-comparison-csv.mjs'
import { checkPrivateM3CsvReportBinding } from '../scripts/qa-m3-private-csv-report-binding-20261017.mjs'
import { parsePrivateM3UniqueKeyJson } from '../scripts/qa-m3-private-unique-json-keys-20261017.mjs'

const cli = fileURLToPath(new URL('../scripts/qa-m3-private-csv-report-binding-20261017.mjs', import.meta.url))
const REFUSAL = 'M3 private CSV/source binding refused'

function fixture() {
  const sheet = buildFictionalPricedSheet(90)
  const report = buildPrivateM3ProductComparison(sheet)
  return { sheet, report, reportText: JSON.stringify(report),
    csv: renderPrivateM3ComparisonCsv(report) }
}

test('strict private JSON key reader preserves legitimate pretty/escaped data and independent nesting', () => {
  const ordinary = '{ "a":1, "nested": {"a":2}, "array":[{"a":3},{"a":4}], "unicode":"Café" }'
  assert.deepEqual(parsePrivateM3UniqueKeyJson(ordinary), JSON.parse(ordinary))
  const escaped = '{"a\\u0062":1,"ab2":2}'
  assert.deepEqual(parsePrivateM3UniqueKeyJson(escaped), JSON.parse(escaped))
  const { report, csv } = fixture()
  for (const text of [JSON.stringify(report), JSON.stringify(report, null, 2)]) {
    assert.equal(checkPrivateM3CsvReportBinding(text, csv).sourceBound, true)
  }
})

test('duplicate object keys and JSON Unicode-escaped aliases fail closed in original private report', () => {
  const { reportText, csv } = fixture()
  const cases = [
    '{"fullBasket":{"plusTotalCents":99999999},' + reportText.slice(1),
    '{"fullB\\u0061sket":{"plusTotalCents":99999999},' + reportText.slice(1),
    reportText.replace('"productName":', '"productName":"PRIVATE_CANARY_A","productName":'),
    reportText.replace('"status":', '"status":"PRIVATE_CANARY_B","status":'),
  ]
  for (const source of cases) {
    assert.notEqual(source, reportText)
    assert.throws(
      () => checkPrivateM3CsvReportBinding(source, csv),
      error => error.message === REFUSAL &&
        !/CANARY|99999999/u.test(error.message),
    )
  }
})

test('private field-sheet duplicate participant and financial keys also fail closed', () => {
  const { sheet, reportText, csv } = fixture()
  const source = JSON.stringify(sheet)
  const cases = [
    source.replace('"participantKey":', '"participantKey":"PRIVATE_CANARY_A","participantKey":'),
    source.replace('"priceCents":', '"priceCents":99999999,"priceCents":'),
  ]
  for (const candidate of cases) {
    assert.notEqual(candidate, source)
    assert.throws(
      () => checkPrivateM3CsvReportBinding(reportText, csv, candidate),
      error => error.message === REFUSAL && !/CANARY|99999999/u.test(error.message),
    )
  }
})

test('duplicate-key syntax refusal handles nesting and escaped-key identity conservatively', () => {
  for (const json of [
    '{"a":1,"a":1}',
    '{"a":1,"\\u0061":2}',
    '{"nested":{"\\u0061":1,"a":2}}',
    '[{"x":1,"x":2}]',
    '{"a":1,}',
    '{"a":1}{"a":2}',
    '{"a":\\u0001}',
  ]) {
    assert.throws(() => parsePrivateM3UniqueKeyJson(json), /M3 private JSON key integrity refused/u)
  }
})

test('private file CLI refuses ambiguous report without output or private data leak', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-duplicate-keys-'))
  try {
    await chmod(dir, 0o700)
    const { reportText, csv } = fixture()
    const source = join(dir, 'report.json')
    const csvPath = join(dir, 'comparison.csv')
    const ambiguous = '{"fullBasket":{"plusTotalCents":99999999},' + reportText.slice(1)
    await writeFile(source, ambiguous, { mode: 0o600 })
    await writeFile(csvPath, csv, { mode: 0o600 })
    const result = spawnSync(process.execPath, [cli, source, csvPath], {
      encoding: 'utf8', timeout: 10000,
    })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, REFUSAL + '\n')
    assert.doesNotMatch(result.stderr, /fullBasket|99999999|report.json|comparison.csv/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
