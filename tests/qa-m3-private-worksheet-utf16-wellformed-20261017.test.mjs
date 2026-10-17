import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

async function realCsv() {
  const base = new URL('../fixtures/m1/', import.meta.url)
  const captures = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, base)))))
  return buildPrivateSelectedWeekObservationWorksheet(captures, ['Ma', 'Do'], {
    plan: structuredClone(m2InitialPlan),
    recipes: structuredClone(m2Recipes),
  }).csv
}
function assertRefused(csv) {
  assert.throws(() => auditPrivateWorksheetCsv(csv),
    /Private worksheet QA audit refused/, 'ill-formed UTF-16 must not silently change operator labels')
}

test('direct private QA API must reject unmatched high and low surrogates, including at string boundaries', async () => {
  const csv = await realCsv()
  assert.equal(auditPrivateWorksheetCsv(csv).rows, 10)
  for (const bad of ['\ud800', '\udfff', '\ud800A', 'A\udfff', '\ud800\ud800', '\udfff\ud800']) {
    const corrupt = csv.replaceAll('Kippendij', bad)
    assert.notEqual(Buffer.from(corrupt, 'utf8').toString('utf8'), corrupt,
      'fixture actually loses information in UTF-8 encoding')
    assertRefused(corrupt)
  }
})

test('split string stdin must reject ill-formed UTF-16 before Buffer encoding and emit nothing', async () => {
  const csv = await realCsv()
  for (const bad of ['\ud800', '\udc00']) {
    const corrupt = csv.replaceAll('Kippendij', bad)
    let written = ''
    await assert.rejects(
      main(Readable.from([corrupt.slice(0, 100), corrupt.slice(100)]),
        text => { written += text }),
      /Private worksheet QA audit refused/,
      'the string-to-Buffer transport must not launder invalid UTF-16 via U+FFFD',
    )
    assert.equal(written, '', 'no partial structured success report')
  }
})

test('valid surrogate-pair emoji, multilingual scripts and literal U+FFFD remain distinguishable', async () => {
  const csv = await realCsv()
  for (const label of ['👩‍🍳 Pão', 'हिन्दी क्‍ष', 'أرز', 'groente\ufffdletter']) {
    const valid = csv.replaceAll('Kippendij', label)
    assert.equal(Buffer.from(valid, 'utf8').toString('utf8'), valid)
    assert.equal(auditPrivateWorksheetCsv(valid).rows, 10)
    let output = ''
    const report = await main(Readable.from([valid]),
      text => { output += text })
    assert.equal(report.rows, 10)
    assert.equal(report.productionReady, false)
    assert.equal(JSON.parse(output).verifiedActualObservations, 0)
  }
})
