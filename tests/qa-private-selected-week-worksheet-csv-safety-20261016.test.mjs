import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES,
  readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet,
  main,
} from '../scripts/retailer-private-selected-week-observation.mjs'

async function fixtures() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(name, root)))))
}

// Exact decoding of a single, fully quoted RFC 4180 row (including comma,
// doubled double-quotes and escape-contaminated user-created labels).
function csvRows(csv) {
  const result = []
  let row = []
  let cell = ''
  let quoted = false
  let start = true
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    if (start) {
      assert.equal(char, '"', `unquoted cell at byte ${i}`)
      quoted = true
      start = false
      continue
    }
    if (quoted) {
      if (char === '"') {
        if (csv[i + 1] === '"') { cell += '"'; i++ }
        else quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === ',' || char === '\n') {
      row.push(cell)
      cell = ''
      start = true
      if (char === '\n') { result.push(row); row = [] }
    } else assert.fail(`unexpected trailing CSV byte ${JSON.stringify(char)}`)
  }
  assert.equal(start, true)
  assert.deepEqual(row, [])
  return result
}

test('all formula prefixes, tabs, newlines, quotes and control characters remain inert in both retailer rows', async () => {
  const originals = await fixtures()
  const labels = [
    '=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)',
    '  =HYPERLINK("https://invalid.example","x")',
    '\t+CMD|/C calc!A0', '\n-17+42',
    '  @CONCAT("abc","def")', '="quoted",\r\nsecond row',
    '\u0000=1+2', 'Café "prijs", verse groente',
  ]
  for (const label of labels) {
    const plan = structuredClone(m2InitialPlan)
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].label = label
    const result = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma'], {plan, recipes})
    const rows = csvRows(result.csv).slice(1)
    assert.equal(rows.length, 10, `row count unchanged by ${JSON.stringify(label)}`)
    assert.ok(rows.every(row => row.length === 18), 'no field/row breakout')
    const chicken = rows.filter(row => row[2] === 'chicken-thigh')
    assert.equal(chicken.length, 2, 'one per store')
    const cleaned = label.replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ')
    const expected = /^\s*[=+\-@]/u.test(cleaned) ? "'" + cleaned : cleaned
    for (const row of chicken) {
      assert.equal(row[3], expected, `formula prefix inert for ${JSON.stringify(label)}`)
      assert.equal(row[0], 'UNOBSERVED_TEMPLATE_NOT_EVIDENCE')
      assert.deepEqual(row.slice(6), Array(12).fill(''))
    }
    assert.equal(result.observedStorePrices, 0)
    assert.equal(result.productionReady, false)
  }
  // Header/row delimiters remain strict, not just a regex-based pretty-print.
})

test('formula-looking ingredient IDs are quoted and cannot turn an unobserved sheet into observed data', async () => {
  const originals = await fixtures()
  for (const id of ['=SUM(1,2)', '+10', '-2', '@SUM(1,2)', '\n=NOW()']) {
    const plan = structuredClone(m2InitialPlan)
    const recipes = structuredClone(m2Recipes)
    recipes[0].ingredients[0].id = id
    const result = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma'], {plan, recipes})
    const rows = csvRows(result.csv).slice(1)
    assert.equal(rows.length, 10)
    const serializedId = id.replace(/[\r\n\u0000-\u001f\u007f]/gu, ' ')
    const expected = /^\s*[=+\-@]/u.test(serializedId) ? "'" + serializedId : serializedId
    assert.equal(rows.filter(row => row[2] === expected).length, 2, `paired inert ID ${id}`)
    assert.ok(rows.every(row => row[0] === 'UNOBSERVED_TEMPLATE_NOT_EVIDENCE'))
    assert.ok(rows.every(row => row.slice(6).every(value => value === '')))
    assert.equal(result.publicSavingsClaimEligible, false)
  }
})

test('standalone process stdout equals API worksheet while hostile argv refuses without data leaks', async () => {
  const originals = await fixtures()
  const path = fileURLToPath(new URL('../scripts/retailer-private-selected-week-observation.mjs', import.meta.url))
  const expected = buildPrivateSelectedWeekObservationWorksheet(originals, ['Ma', 'Do'])
  const runner = args => spawnSync(process.execPath, ['--experimental-strip-types', path, ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 65536,
  })
  const positive = runner(['--days', 'Ma,Do'])
  assert.equal(positive.error, undefined)
  assert.equal(positive.status, 0, positive.stderr)
  assert.equal(positive.stdout, expected.csv, 'standalone invocation produces exact offline worksheet')
  assert.equal(positive.stderr, '', 'no diagnostic source leak')
  for (const args of [
    ['--days', 'Ma,Ma'], ['--days', 'Vr'], ['--days', 'Ma, Do'],
    ['--output', '/tmp/observation.csv'], ['--days'], ['--days', 'Ma', '--rights-approved'],
    ['--days', 'Ma\nhttps://secrets.invalid/?access_token=foo'],
  ]) {
    const result = runner(args)
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2, JSON.stringify(args))
    assert.equal(result.stdout, '', 'invalid options must not emit a partial CSV')
    assert.match(result.stderr, /worksheet refused/i)
    assert.doesNotMatch(result.stderr, /access_token|secrets\.invalid|observedPriceEUR|https:/)
  }
})

test('exported async CLI accepts only inert argv and never calls Proxy traps or getters', async () => {
  const expected = buildPrivateSelectedWeekObservationWorksheet(await fixtures(), ['Ma'])
  let out = ''
  const result = await main(['--days', 'Ma'], data => { out += data })
  assert.equal(out, expected.csv)
  assert.equal(result.rows, expected.rows)
  assert.equal(result.productionReady, false)

  for (const invalid of [
    {length:0}, {0:'--days',1:'Ma',length:2}, Object.create(['--days', 'Ma']),
  ]) {
    let written = 0
    await assert.rejects(main(invalid, () => { written++ }))
    assert.equal(written, 0, 'not even partial output before rejecting non-array argv')
  }
  let touched = 0
  const poisoned = ['--days', 'Ma']
  Object.defineProperty(poisoned, 1, {
    get() { touched++; throw new Error('unexpected getter execution') }, enumerable: true,
  })
  await assert.rejects(main(poisoned, () => { touched++ }))
  assert.equal(touched, 0)
  const proxy = new Proxy([], {
    get() { touched++; throw new Error('unexpected proxy get') },
  })
  await assert.rejects(main(proxy, () => { touched++ }))
  assert.equal(touched, 0)
})
