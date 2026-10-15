import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { m2DefaultActiveDays, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { m3FieldSheetMatchesPlannerWeek } from '../src/features/observation/m3PlannerMeasurementWeek.ts'

const copy = value => structuredClone(value)

test('M3 fixed survey recognizes only the exact four-day recipe demand, irrespective of ordering', () => {
  assert.equal(m3FieldSheetMatchesPlannerWeek(m2InitialPlan, m2DefaultActiveDays), true)
  assert.equal(m3FieldSheetMatchesPlannerWeek(
    [...m2InitialPlan].reverse(), [...m2DefaultActiveDays].reverse()), true)
  assert.equal(buildObservationSheet().requirements.length, 11)
  for (const day of m2DefaultActiveDays) {
    assert.equal(m3FieldSheetMatchesPlannerWeek(
      m2InitialPlan, m2DefaultActiveDays.filter(d => d !== day)), false)
  }
  for (const row of m2InitialPlan) {
    const changed = copy(m2InitialPlan)
    const index = changed.findIndex(meal => meal.day === row.day)
    changed[index].recipeId = row.recipeId === 'pasta' ? 'teriyaki' : 'pasta'
    assert.equal(m3FieldSheetMatchesPlannerWeek(changed, m2DefaultActiveDays), false,
      'changed recipe on ' + row.day)
  }
})

test('M3 always refuses malformed, missing, duplicated and invented planner identities', () => {
  const rows = copy(m2InitialPlan)
  for (const [plan, days] of [
    [undefined, m2DefaultActiveDays],
    [m2InitialPlan, null],
    [[], []],
    [rows.slice(1), m2DefaultActiveDays],
    [[...rows, rows[0]], m2DefaultActiveDays],
    [[...rows.slice(0, 3), rows[0]], m2DefaultActiveDays],
    [rows.map((r, index) => index === 0 ? { ...r, day: 'Vrij' } : r), m2DefaultActiveDays],
    [rows.map((r, index) => index === 0 ? { ...r, recipeId: 'not-allowed' } : r), m2DefaultActiveDays],
    [[null, ...rows.slice(1)], m2DefaultActiveDays],
    [m2InitialPlan, ['Ma', 'Di', 'Wo', 'Wo']],
    [m2InitialPlan, ['Ma', 'Di', 'Wo', 'Vrij']],
    [m2InitialPlan, [1, 'Di', 'Wo', 'Do']],
  ]) {
    assert.equal(m3FieldSheetMatchesPlannerWeek(plan, days), false)
  }
  const trapped = new Proxy([], { get() { throw new Error('private planner value') } })
  assert.equal(m3FieldSheetMatchesPlannerWeek(trapped, m2DefaultActiveDays), false)
})

test('four sparse day slots and inherited/getter replacements cannot hide a changed survey week', () => {
  const unchangedPlan = copy(m2InitialPlan)
  const untouchedDays = copy(m2DefaultActiveDays)
  for (let missing = 0; missing < untouchedDays.length; missing++) {
    const sparse = [...untouchedDays]
    delete sparse[missing]
    const original = sparse.slice()
    assert.equal(sparse.length, 4)
    assert.equal(new Set(sparse).size, 4,
      'independent demonstration of Set sparse-hole false-positive')
    assert.equal(m3FieldSheetMatchesPlannerWeek(unchangedPlan, sparse), false,
      'missing own indexed day slot ' + missing + ' must fail closed')
    assert.equal(missing in sparse, false)
    assert.deepEqual(sparse, original)
    const inherited = [...untouchedDays]
    delete inherited[missing]
    const prototype = Object.create(Array.prototype)
    prototype[missing] = untouchedDays[missing]
    Object.setPrototypeOf(inherited, prototype)
    assert.equal(m3FieldSheetMatchesPlannerWeek(unchangedPlan, inherited), false,
      'a prototype-filled missing indexed day must not restore study trust')
    const getter = [...untouchedDays]
    Object.defineProperty(getter, missing, {
      get() { throw new Error('sensitive live Planner getter') },
      enumerable: true,
      configurable: true,
    })
    assert.equal(m3FieldSheetMatchesPlannerWeek(unchangedPlan, getter), false,
      'own getter must not run or impersonate a real selected day')
  }
  assert.deepEqual(unchangedPlan, m2InitialPlan)
  assert.deepEqual(untouchedDays, m2DefaultActiveDays)
  assert.equal(buildObservationSheet().evidenceStatus, 'collection-template-not-evidence')
})

test('the mismatch check never mutates the planner or real blank 11+11 field sheet', () => {
  const planned = copy(m2InitialPlan)
  const selected = copy(m2DefaultActiveDays)
  const sheet = buildObservationSheet()
  const frozenSheet = copy(sheet)
  assert.equal(m3FieldSheetMatchesPlannerWeek(planned, selected), true)
  planned[0].recipeId = 'pasta'
  assert.equal(m3FieldSheetMatchesPlannerWeek(planned, selected), false)
  assert.deepEqual(selected, m2DefaultActiveDays)
  assert.deepEqual(sheet, frozenSheet)
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  assert.ok(sheet.baseline.lines.every(x => x.observedProduct.priceCents === null))
})

test('actual Meten screen shows clear study mismatch and never changes the 22 capture rows', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const render = match =>
      renderToStaticMarkup(createElement(ObservationView, { plannerWeekMatchesTemplate: match }))
    const normal = render(true)
    const changed = render(false)
    const isolated = renderToStaticMarkup(createElement(ObservationView))
    for (const html of [normal, changed, isolated]) {
      assert.match(html, /vaste onderzoeksweek/)
      assert.match(html, /elf dezelfde ingrediënten bij PLUS en DekaMarkt/)
      assert.match(html, /nog geen besparingsbewijs/)
      assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
      assert.doesNotMatch(html, /besparing bewezen|actuele winkelprijs beschikbaar/i)
    }
    assert.doesNotMatch(normal, /data-observation-planner-week-mismatch/)
    assert.doesNotMatch(isolated, /data-observation-planner-week-mismatch/)
    assert.match(changed, /role="alert" data-observation-planner-week-mismatch/)
    assert.match(changed, /Je Planner wijkt af van de vaste meetweek/)
    assert.match(changed, /Je invoer blijft intact/)
    assert.match(changed, /niet overgenomen/)
    const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    assert.match(app, /plannerWeekMatchesTemplate=\{m3FieldSheetMatchesPlannerWeek\(plannedMeals, activeDays\)\}/)
  } finally {
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore)
    else delete globalThis.window
    await vite.close()
  }
})
