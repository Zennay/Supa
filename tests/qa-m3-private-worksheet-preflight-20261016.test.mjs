import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import test from 'node:test'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  RETAILER_REVIEWED_FIXTURES, readBoundedRegularReviewedFixture,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import {
  buildPrivateSelectedWeekObservationWorksheet,
} from '../scripts/retailer-private-selected-week-observation.mjs'
import { auditPrivateWorksheetCsv, main } from '../scripts/qa-m3-private-worksheet-preflight.mjs'

async function records() {
  const root = new URL('../fixtures/m1/', import.meta.url)
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(n =>
    readBoundedRegularReviewedFixture(fileURLToPath(new URL(n, root)))))
}
async function worksheet(days = ['Ma', 'Di', 'Wo', 'Do'], recipeTransform = () => {}) {
  const original = await records()
  const plan = structuredClone(m2InitialPlan)
  const recipes = structuredClone(m2Recipes)
  recipeTransform(recipes)
  const out = buildPrivateSelectedWeekObservationWorksheet(original, days, { plan, recipes })
  assert.equal(out.productionReady, false)
  return out.csv
}
function fail(csv, reason) {
  assert.throws(() => auditPrivateWorksheetCsv(csv), /Private worksheet QA audit refused/, reason)
}

test('QA preflight passes the actual six-archive 11x2 and 5x2 unobserved field templates only', async () => {
  for (const [days, lines, needs] of [
    [['Ma', 'Di', 'Wo', 'Do'], 22, 11],
    [['Ma', 'Do'], 10, 5],
  ]) {
    const csv = await worksheet(days)
    assert.deepEqual(auditPrivateWorksheetCsv(csv), {
      mode: 'm3-blank-worksheet-qa-only',
      rows: lines,
      ingredientNeeds: needs,
      pairedRetailers: 2,
      verifiedActualObservations: 0,
      sourceRightsVerified: false,
      productionReady: false,
      publicSavingsClaimEligible: false,
    })
  }
})

test('QA preflight refuses missing or duplicate retailer pairs, uneven needs and shifted quantities', async () => {
  const csv = await worksheet(['Ma'])
  const lines = csv.trimEnd().split('\n')
  fail(lines.slice(0, -1).join('\n') + '\n', 'missing Deka counterpart')
  fail([...lines, lines[1]].join('\n') + '\n', 'extra duplicated store row')
  fail([lines[0], ...lines.slice(1).map(line => line.replace('"dekamarkt"', '"plus"'))]
    .join('\n') + '\n', 'two PLUS sides, no Deka counterpart')
  const chicken = lines.findIndex(line => line.includes('"dekamarkt","chicken-thigh"'))
  assert.ok(chicken > 0)
  const changed = [...lines]
  changed[chicken] = changed[chicken].replace('"300","g"', '"301","g"')
  fail(changed.join('\n') + '\n', 'same ingredient demand must match across stores')
})

test('QA preflight refuses fabricated observations, scientific/huge quantity and malformed CSV', async () => {
  const csv = await worksheet(['Ma'])
  const lines = csv.trimEnd().split('\n')
  fail(csv.replace('"g","",""', '"g","2026-10-16T12:00:00Z",""'),
    'timestamp must remain genuinely unobserved')
  fail(csv.replace('"300","g"', '"1e-14","g"'), 'sub-measurable exponent amount')
  fail(csv.replace('"300","g"', '"1e+21","g"'), 'astronomical exponent amount')
  fail(csv.replace('"300","g"', '"1000001","g"'), 'bounded review magnitude')
  fail(csv.replace('"UNOBSERVED_TEMPLATE_NOT_EVIDENCE"', '"OBSERVED"'), 'not a real field record')
  fail(csv.replace('"evidenceStatus"', '"sourceUrl"'), 'header cannot be rewritten')
  fail(csv.slice(0, -1), 'terminal newline is required')
  fail('unquoted,bad,header\n', 'only strict quoted RFC4180 cells')
  fail([...lines, ''].join('\n') + ' ', 'trailing whitespace or extra content')
})

test('QA preflight rejects invisible/bidi or formula-looking labels while allowing legitimate joined scripts', async () => {
  const benign = await worksheet(['Ma'], recipes => {
    recipes[0].ingredients[0].label = '👩‍🍳 Pão क्‍ष می‌روم'
  })
  assert.equal(auditPrivateWorksheetCsv(benign).rows, 10)
  const safeFormula = await worksheet(['Ma'], recipes => {
    recipes[0].ingredients[0].label = '=SUM(1,2)'
  })
  assert.equal(auditPrivateWorksheetCsv(safeFormula).rows, 10,
    'the producer safely apostrophe-escapes visible formula labels')
  for (const label of [
    'Kip\u202e321 gp',
    'Kip\u2066store\u2069',
    '\u200b=1+1',
    '\u200d=1+1',
  ]) {
    const csv = await worksheet(['Ma'], recipes => {
      recipes[0].ingredients[0].label = label
    })
    fail(csv, 'formatting control cannot enter a human-readable sheet')
  }
})

test('bounded stdin and standalone QA CLI never echo raw labels, historical prices or partial output', async () => {
  const csv = await worksheet(['Ma'])
  const bytes = Buffer.from(csv, 'utf8')
  let output = ''
  const summary = await main(Readable.from([
    bytes.subarray(0, 5), bytes.subarray(5, 23), bytes.subarray(23),
  ]), chunk => { output += chunk })
  assert.equal(summary.rows, 10)
  assert.deepEqual(JSON.parse(output), summary)
  assert.doesNotMatch(output, /Kippendij|plus|dekamarkt|observedAt|capturedAt/)
  let leaked = ''
  await assert.rejects(main(Readable.from([Buffer.alloc(1_048_577, 65)]),
    data => { leaked += data }), /Private worksheet QA audit refused/)
  assert.equal(leaked, '')

  const cli = fileURLToPath(new URL('../scripts/qa-m3-private-worksheet-preflight.mjs', import.meta.url))
  const good = spawnSync(process.execPath, [cli], { input: csv, encoding: 'utf8', timeout: 12000 })
  assert.equal(good.status, 0, good.stderr)
  assert.deepEqual(JSON.parse(good.stdout), summary)
  const bad = spawnSync(process.execPath, [cli], {
    input: csv.replace('"300","g"', '"1e+21","g"'),
    encoding: 'utf8', timeout: 12000,
  })
  assert.equal(bad.status, 2)
  assert.equal(bad.stdout, '')
  assert.match(bad.stderr, /Private worksheet QA audit refused/)
  assert.doesNotMatch(bad.stderr, /1e\+21|Kippendij|plus|dekamarkt/)
})
