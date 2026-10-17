import assert from 'node:assert/strict'
import test from 'node:test'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildPrivateSelectedWeekObservationWorksheet } from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

async function actualBlankCsv(modifyRecipes = () => {}) {
  const root = new URL('../fixtures/m1/', import.meta.url)
  const sources = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
  const recipes = structuredClone(m2Recipes)
  modifyRecipes(recipes)
  return buildPrivateSelectedWeekObservationWorksheet(sources, ['Ma', 'Di', 'Wo', 'Do'], {
    plan: structuredClone(m2InitialPlan), recipes,
  }).csv
}

const cellsOf = row => {
  const cells = row.match(/"(?:[^"]|"")*"/gu)
  assert.equal(cells?.length, 18, 'test source is the genuine eighteen-column template')
  assert.equal(cells.join(','), row, 'test mutation uses an unambiguous fully quoted row')
  return cells
}
const replaceRow = (lines, index, newCells) => {
  const copy = [...lines]
  copy[index] = newCells.join(',')
  return copy.join('\n') + '\n'
}

test('mutation oracle: all 22 x 12 observation cells must remain blank, never partially certified', async () => {
  const csv = await actualBlankCsv()
  const lines = csv.trimEnd().split('\n')
  assert.equal(lines.length, 23, 'canonical 11 needs by two retailers plus header')
  assert.equal(auditPrivateWorksheetCsv(csv).rows, 22)
  let rejected = 0
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const fields = cellsOf(lines[rowIndex])
    for (let column = 6; column < 18; column++) {
      const mutated = [...fields]
      mutated[column] = '"SYNTHETIC_NOT_OBSERVED"'
      assert.throws(
        () => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, mutated)),
        /Private worksheet QA audit refused/,
        `row ${rowIndex}, private observation column ${column}`,
      )
      rejected++
    }
  }
  assert.equal(rejected, 264, 'exhaustive count of refused fabricated field-cell mutations')
})

test('mutation oracle: every one of the 22 evidence statuses must remain unobserved', async () => {
  const csv = await actualBlankCsv()
  const lines = csv.trimEnd().split('\n')
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const cells = cellsOf(lines[rowIndex])
    cells[0] = '"REAL_STORE_EVIDENCE"'
    assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, cells)),
      /Private worksheet QA audit refused/)
  }
})

test('mutation oracle: all 22 rows preserve exact retailer-specific identity and paired demand', async () => {
  const csv = await actualBlankCsv()
  const lines = csv.trimEnd().split('\n')
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const fields = cellsOf(lines[rowIndex])
    const original = fields[1]
    assert.ok(['"plus"', '"dekamarkt"'].includes(original))
    const wrongShop = [...fields]
    wrongShop[1] = original === '"plus"' ? '"dekamarkt"' : '"plus"'
    assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, wrongShop)),
      /Private worksheet QA audit refused/, `store row ${rowIndex}`)
    const wrongAmount = [...fields]
    const number = Number(fields[4].slice(1, -1))
    wrongAmount[4] = '"' + (number + 1) + '"'
    assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, wrongAmount)),
      /Private worksheet QA audit refused/, `quantity row ${rowIndex}`)
    const wrongUnit = [...fields]
    wrongUnit[5] = fields[5] === '"g"' ? '"ml"' : '"g"'
    assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, wrongUnit)),
      /Private worksheet QA audit refused/, `unit row ${rowIndex}`)
  }
})

test('independent stdin decoding accepts UTF-8 split inside a real multilingual grapheme', async () => {
  const csv = await actualBlankCsv(recipes => {
    recipes[0].ingredients[0].label = 'Crème fraîche 👩‍🍳 क्‍ष'
  })
  const bytes = Buffer.from(csv, 'utf8')
  const start = bytes.indexOf(Buffer.from('è', 'utf8'))
  assert.ok(start > 0, 'actual multibyte UTF-8 candidate')
  const source = Readable.from([
    bytes.subarray(0, start + 1),
    bytes.subarray(start + 1, start + 2),
    bytes.subarray(start + 2),
  ])
  let output = ''
  const report = await main(source, text => { output += text })
  assert.equal(report.rows, 22)
  assert.equal(report.ingredientNeeds, 11)
  assert.equal(report.verifiedActualObservations, 0)
  assert.equal(report.productionReady, false)
  assert.deepEqual(JSON.parse(output), report)
  const malformed = Buffer.concat([
    bytes.subarray(0, start),
    Buffer.from([0xc3, 0x28]),
    bytes.subarray(start + 2),
  ])
  let leaked = ''
  await assert.rejects(
    main(Readable.from([malformed]), text => { leaked += text }),
    /Private worksheet QA audit refused/,
  )
  assert.equal(leaked, '', 'no partial output on invalid UTF-8')
})

test('mutation oracle: all 18 header names and all 22 paired ingredient IDs/labels are immutable', async () => {
  const csv = await actualBlankCsv()
  const lines = csv.trimEnd().split('\n')
  assert.equal(lines.length, 23)
  const header = cellsOf(lines[0])
  for (let column = 0; column < 18; column++) {
    const changed = [...header]
    changed[column] = '"UNKNOWN_FIELD_' + column + '"'
    assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, 0, changed)),
      /Private worksheet QA audit refused/, 'header column ' + column)
  }
  let changedIdentities = 0
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const row = cellsOf(lines[rowIndex])
    for (const [column, value] of [
      [2, '"completely-unpaired-ingredient-' + rowIndex + '"'],
      [3, '"SYNTHETIC_WRONG_LABEL_' + rowIndex + '"'],
    ]) {
      const changed = [...row]
      changed[column] = value
      assert.throws(() => auditPrivateWorksheetCsv(replaceRow(lines, rowIndex, changed)),
        /Private worksheet QA audit refused/,
        'row ' + rowIndex + ', identity column ' + column)
      changedIdentities++
    }
  }
  assert.equal(changedIdentities, 44)
})
