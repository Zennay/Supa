import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import {
  selectedFixtureWeek,
  main as reviewedMemory,
} from '../scripts/retailer-reviewed-custom-week.mjs'

// Backwards compatibility: the new --plan recipe swap mode must not change the
// original --days subset behavior or reveal private retailer data. Historical
// offline catalog only; no active source license, live prices or M3 claim.
const memoryProcess = fileURLToPath(new URL('../scripts/retailer-reviewed-custom-week.mjs', import.meta.url))
const sqliteProcess = fileURLToPath(new URL('../scripts/retailer-private-sqlite-planner-review.mjs', import.meta.url))
const defaults = new Map(m2InitialPlan.map(item => [item.day, item.recipeId]))
const sourcePlan = structuredClone(m2InitialPlan)

function choices(mask) {
  return m2DefaultActiveDays.filter((_, i) => (mask & (1 << i)) !== 0)
}
function specs(mask) {
  const selected = choices(mask)
  return {
    legacy: ['--days', selected.toReversed().join(',')],
    planned: ['--plan', selected.map(day => day + ':' + defaults.get(day)).join(',')],
    selected,
  }
}
function privateResult(record, text) {
  assert.equal(record.externalRequests, 0)
  assert.equal(record.livePricesAvailable, false)
  assert.equal(record.publicSavingsClaimEligible, false)
  assert.doesNotMatch(text,
    /https?:|sourceUrl|productName|participantKey|sourceProductId|capturedAt|priceCents|savingsCents|€|sha256/i)
}
function cli(path, args) {
  const run = spawnSync(process.execPath, ['--experimental-strip-types', path, ...args], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024,
  })
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  const result = JSON.parse(run.stdout)
  privateResult(result, run.stdout)
  return result
}

test('all 15 legacy --days subsets retain the exact approved-recipe --plan review totals, even in reverse argument order', async () => {
  let cases = 0
  for (let mask = 1; mask < 16; mask++) {
    const { legacy, planned, selected } = specs(mask)
    assert.deepEqual(selectedFixtureWeek(legacy).days, selected)
    assert.deepEqual(selectedFixtureWeek(planned).days, selected)
    let leftText = '', rightText = ''
    const left = await reviewedMemory(legacy, text => { leftText += text })
    const right = await reviewedMemory(planned, text => { rightText += text })
    assert.deepEqual(left, right, 'days and equivalent selected default recipes')
    assert.equal(leftText, rightText, 'operator-visible JSON also must agree')
    assert.equal(left.selectedMeals, selected.length)
    assert.equal(left.activeDays, selected.length)
    privateResult(left, leftText)
    cases++
  }
  assert.equal(cases, 15)
  assert.deepEqual(m2InitialPlan, sourcePlan)
})

test('real memory and private SQLite/Python subprocesses preserve default-day compatibility across 1–4 active day scopes', () => {
  for (const mask of [1, 3, 7, 15]) {
    const { legacy, planned, selected } = specs(mask)
    for (const path of [memoryProcess, sqliteProcess]) {
      const fromLegacy = cli(path, legacy)
      const fromExplicit = cli(path, planned)
      assert.deepEqual(fromLegacy, fromExplicit,
        'existing --days matches new equivalent --plan for every CLI implementation')
      const dayCount = path === sqliteProcess
        ? fromLegacy.selectedMealDays : fromLegacy.selectedMeals
      assert.equal(dayCount, selected.length)
      if (path === sqliteProcess) {
        assert.equal(fromLegacy.sourceSnapshots, 6)
        assert.equal(fromLegacy.productionEnabled, false)
      }
    }
  }
})
