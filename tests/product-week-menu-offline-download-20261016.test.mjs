import assert from 'node:assert/strict'
import test from 'node:test'
import { downloadPreparedWeekMenu, weekMenuDownloadName } from '../src/features/planner/downloadWeekMenuText.ts'
import { formatShareableWeek } from '../src/features/planner/weekPlanShare.ts'
import { m2Recipes, m2InitialPlan } from '../src/data/m2Fixture.ts'

const preview = (includeBudget = false) => formatShareableWeek({
  plannedMeals: m2InitialPlan,
  activeDays: ['Ma', 'Wo'],
  recipes: m2Recipes,
  budget: 35,
  includeBudget,
})

function fakePort(events, field, mutate = () => {}) {
  return {
    createObjectURL: text => {
      events.push(['create', text])
      mutate()
      return 'blob:supa-weekmenu-local'
    },
    triggerDownload: (url, filename) => events.push(['download', url, filename]),
    scheduleRevoke: url => events.push(['revoke', url]),
  }
}

test('the currently displayed offline week menu downloads only on explicit user action', () => {
  const text = preview()
  const field = { readOnly: true, value: text }
  const events = []
  assert.equal(downloadPreparedWeekMenu(field, text, fakePort(events, field)), true)
  assert.deepEqual(events, [
    ['create', text],
    ['download', 'blob:supa-weekmenu-local', weekMenuDownloadName],
    ['revoke', 'blob:supa-weekmenu-local'],
  ])
  assert.equal(weekMenuDownloadName, 'supa-weekmenu.txt')
  assert.doesNotMatch(text, /Weekbudget|€|bespaard/)
  assert.match(text, /geen prijsopgave/i)
})

test('budget is saved only when the user had already opted into that exact prepared preview', () => {
  const privateText = preview()
  const publicChoice = preview(true)
  const events = []
  const field = { readOnly: true, value: privateText }
  assert.equal(downloadPreparedWeekMenu(field, publicChoice, fakePort(events, field)), false)
  assert.deepEqual(events, [])
  field.value = publicChoice
  assert.equal(downloadPreparedWeekMenu(field, publicChoice, fakePort(events, field)), true)
  assert.match(events[0][1], /Weekbudget \(eigen voorkeur\)/)
  assert.doesNotMatch(privateText, /Weekbudget/)
})

test('stale, writable, missing, malformed or oversized previews never create downloads', () => {
  const text = preview()
  const cases = [
    [null, text],
    [{ readOnly: false, value: text }, text],
    [{ readOnly: true, value: 'Vorige week' }, text],
    [{ readOnly: true, value: '' }, ''],
    [{ readOnly: true, value: 'Fake receipt' }, 'Fake receipt'],
    [{ readOnly: true, value: text.repeat(500) }, text.repeat(500)],
  ]
  for (const [field, expected] of cases) {
    const events = []
    assert.equal(downloadPreparedWeekMenu(field, expected, fakePort(events, field)), false)
    assert.deepEqual(events, [])
  }
})

test('after local Blob preparation, changed visible text never triggers a stale private download', () => {
  const text = preview(true)
  const field = { readOnly: true, value: text }
  const events = []
  assert.equal(downloadPreparedWeekMenu(field, text,
    fakePort(events, field, () => { field.value = 'Nieuwe week' })), false)
  assert.deepEqual(events.map(x => x[0]), ['create', 'revoke'])
})

test('browser denial and malformed object URLs safely fall back without network or clipboard', () => {
  const text = preview()
  const field = { readOnly: true, value: text }
  const calls = []
  assert.equal(downloadPreparedWeekMenu(field, text, {
    createObjectURL: () => { throw new Error('Blob URL denied') },
    triggerDownload: () => calls.push('trigger'),
    scheduleRevoke: () => calls.push('revoke'),
  }), false)
  assert.equal(downloadPreparedWeekMenu(field, text, {
    createObjectURL: () => 'https://remote.invalid/steal',
    triggerDownload: () => calls.push('trigger'),
    scheduleRevoke: () => calls.push('revoke'),
  }), false)
  assert.equal(downloadPreparedWeekMenu(field, text, {
    createObjectURL: () => 123,
    triggerDownload: () => calls.push('trigger'),
    scheduleRevoke: () => calls.push('revoke'),
  }), false)
  assert.deepEqual(calls, [])
  assert.equal(downloadPreparedWeekMenu(field, text, {
    createObjectURL: () => 'blob:local',
    triggerDownload: () => { throw new Error('not supported') },
    scheduleRevoke: () => calls.push('revoke'),
  }), false)
  assert.deepEqual(calls, ['revoke'])
})
