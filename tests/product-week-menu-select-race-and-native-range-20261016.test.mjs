import assert from 'node:assert/strict'
import test from 'node:test'
import { selectWeekMenuText, weekMenuSelectionFeedback } from '../src/features/planner/selectWeekMenuText.ts'

const TEXT = 'SUPA · Weekmenu\n\nMa: Kip\n\nDit is een planning, geen prijsopgave.'

test('refuse stale or newly writable private textarea after focus changes it', () => {
  for (const mutation of [
    field => { field.value = 'vorige week' },
    field => { field.readOnly = false },
  ]) {
    const calls = []
    const field = {
      readOnly: true, value: TEXT,
      focus() { calls.push('focus'); mutation(this) },
      select() { calls.push('select') },
      setSelectionRange() { calls.push('range') },
    }
    assert.equal(selectWeekMenuText(field, TEXT), false)
    assert.deepEqual(calls, ['focus'])
  }
})

test('refuse stale content or lost read-only guard between select() and setSelectionRange()', () => {
  for (const mutation of [
    field => { field.value = 'nieuw recept' },
    field => { field.readOnly = false },
  ]) {
    const calls = []
    const field = {
      readOnly: true, value: TEXT,
      focus() { calls.push('focus') },
      select() { calls.push('select'); mutation(this) },
      setSelectionRange() { calls.push('range') },
    }
    assert.equal(selectWeekMenuText(field, TEXT), false)
    assert.deepEqual(calls, ['focus', 'select'])
  }
})

test('mobile browser ignoring setSelectionRange is never reported as successful copying or selection', () => {
  const field = {
    readOnly: true, value: TEXT,
    selectionStart: 5, selectionEnd: 5,
    focus() {}, select() {},
    setSelectionRange() { /* Android-like selection silently ignored */ },
  }
  assert.equal(selectWeekMenuText(field, TEXT), false)
  assert.match(weekMenuSelectionFeedback(false), /Houd de tekst ingedrukt/)
  assert.doesNotMatch(weekMenuSelectionFeedback(false), /gekopieerd|opgeslagen/i)
})

test('native full range and post-selection read-only truth enable accurate selection feedback', () => {
  const field = {
    readOnly: true, value: TEXT,
    selectionStart: 5, selectionEnd: 5,
    focus() {}, select() {},
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end },
  }
  assert.equal(selectWeekMenuText(field, TEXT), true)
  assert.equal(field.selectionStart, 0)
  assert.equal(field.selectionEnd, TEXT.length)
  assert.match(weekMenuSelectionFeedback(true), /Tekst geselecteerd/)
})

test('focus and range exceptions are denied, with no automatic clipboard or storage effects', () => {
  const field = {
    readOnly: true, value: TEXT,
    focus() {},
    select() {},
    setSelectionRange() { throw new Error('selection blocked') },
  }
  assert.equal(selectWeekMenuText(field, TEXT), false)
  assert.equal(selectWeekMenuText(null, TEXT), false)
  assert.equal(selectWeekMenuText({ ...field, readOnly: false }, TEXT), false)
})
