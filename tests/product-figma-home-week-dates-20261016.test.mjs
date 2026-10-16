import assert from 'node:assert/strict'
import test from 'node:test'
import { upcomingHomeWeek } from '../src/features/home/homeWeekDates.ts'

test('Figma Home uses upcoming local Sunday–Thursday instead of frozen October 19–23 dates', () => {
  const days = upcomingHomeWeek(new Date(2026, 9, 16, 12))
  assert.deepEqual(days.map(({ label, date, plannerDay }) => [label, date, plannerDay]), [
    ['Z', 18, 'Zo'], ['M', 19, 'Ma'], ['D', 20, 'Di'], ['W', 21, 'Wo'], ['D', 22, 'Do'],
  ])
  assert.equal(days.length, 5)
  assert.equal(new Set(days.map(({ fullName }) => fullName)).size, 5)
})

test('Figma Home handles Sunday today, DST and December/January boundaries using calendar dates', () => {
  const sunday = upcomingHomeWeek(new Date(2026, 9, 18, 12))
  assert.equal(sunday[0].date, 18)
  const dst = upcomingHomeWeek(new Date(2026, 9, 24, 12))
  assert.deepEqual(dst.map(({ date }) => date), [25, 26, 27, 28, 29])
  const newYear = upcomingHomeWeek(new Date(2026, 11, 31, 12))
  assert.deepEqual(newYear.map(({ date, month, year }) => [date, month, year]), [
    [3, 0, 2027], [4, 0, 2027], [5, 0, 2027], [6, 0, 2027], [7, 0, 2027],
  ])
})
