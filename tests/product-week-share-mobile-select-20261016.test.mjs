import assert from 'node:assert/strict'
import test from 'node:test'
import { selectWeekMenuText } from '../src/features/planner/selectWeekMenuText.ts'

test('manual week sharing selects full current text for mobile browsers, without clipboard', () => {
  const calls = []
  const value = 'Ma: Tikka\\nWo: Pasta'
  const field = {
    value,
    readOnly: true,
    focus: () => calls.push('focus'),
    select: () => calls.push('select'),
    setSelectionRange: (...args) => calls.push(['range', ...args]),
  }
  assert.equal(selectWeekMenuText(field, value), true)
  assert.deepEqual(calls, ['focus', 'select', ['range', 0, value.length]])
})

test('never select stale, empty, writable or replaced private week share text', () => {
  const calls = []
  const field = {
    value: 'Ma: Tikka',
    readOnly: true,
    focus: () => calls.push('focus'),
    select: () => calls.push('select'),
    setSelectionRange: () => calls.push('range'),
  }
  assert.equal(selectWeekMenuText(null, field.value), false)
  assert.equal(selectWeekMenuText(field, 'Ma: Nieuwe maaltijd'), false)
  assert.equal(selectWeekMenuText(field, ''), false)
  field.readOnly = false
  assert.equal(selectWeekMenuText(field, field.value), false)
  assert.deepEqual(calls, [])
  field.readOnly = true
  field.focus = () => {
    calls.push('focus')
    field.value = 'Nieuwe week'
  }
  assert.equal(selectWeekMenuText(field, 'Ma: Tikka'), false)
  assert.deepEqual(calls, ['focus'])
})

test('failed mobile selection never throws and falls back to manual selection', () => {
  const field = {
    value: 'Ma: Tikka',
    readOnly: true,
    focus: () => {},
    select: () => {},
    setSelectionRange: () => { throw new Error('device denies selection') },
  }
  assert.equal(selectWeekMenuText(field, field.value), false)
})
