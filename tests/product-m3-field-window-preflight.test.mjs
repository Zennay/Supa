import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import test from 'node:test'

import {
  assessFieldWindow,
  main,
  MAX_FIELD_WINDOW_MS,
  parseFieldInstant,
} from '../scripts/m3-field-window-preflight.mjs'

const NOW = Date.parse('2026-10-10T23:00:00Z')
const BASELINE = '2026-10-08T12:00:00.000+02:00'
const CANDIDATE = '2026-10-09T10:00:00.000Z'

test('M3 field clock accepts timezone-bearing calendar-real instants', () => {
  assert.equal(parseFieldInstant('2024-02-29T12:00:00Z'), Date.parse('2024-02-29T12:00:00Z'))
  assert.equal(parseFieldInstant('2026-10-09T20:00:00-14:00'),
    Date.parse('2026-10-09T20:00:00-14:00'))
  assert.equal(parseFieldInstant('2026-10-09T22:00:00+14:00'),
    Date.parse('2026-10-09T22:00:00+14:00'))
  assert.equal(parseFieldInstant('0099-01-01T00:00:00Z'),
    new Date('0099-01-01T00:00:00Z').getTime())
})

test('M3 field clock fails closed on invalid calendar, non-ISO, and timezone-free dates', () => {
  const bad = [
    '2026-02-29T10:00:00Z', '2026-04-31T10:00:00Z',
    '2026-13-01T10:00:00Z', '2026-10-09T24:00:00Z',
    '2026-10-09T10:60:00Z', '2026-10-09T10:00:60Z',
    '2026-10-09T10:00:00', '2026-10-09',
    'Fri, 09 Oct 2026 10:00:00 GMT',
    '2026-10-09T10:00:00.1234Z',
    '2026-10-09T10:00:00+15:00',
    '2026-10-09T10:00:00-15:00',
    '2026-10-09T10:00:00+14:30',
    '2026-10-09T10:00:00+23:00',
    '2026-10-09T10:00:00+02:60',
    null, [], {}, 0,
  ]
  for (const input of bad) {
    assert.equal(parseFieldInstant(input), null, String(input))
  }
})

test('valid non-future PLUS/DekaMarkt clocks exactly 24h apart are only window-eligible', () => {
  const result = assessFieldWindow({
    baselineAt: '2026-10-08T12:00:00Z',
    candidateAt: '2026-10-09T12:00:00Z',
    nowMs: NOW,
  })
  assert.deepEqual(result, { status: 'within-window', elapsedMinutes: 1440 })
  assert.equal(MAX_FIELD_WINDOW_MS, 86_400_000)
  assert.equal('claimable' in result, false)
})

test('24 hours plus a millisecond is invalid even though displayed minutes round the same', () => {
  assert.deepEqual(assessFieldWindow({
    baselineAt: '2026-10-08T12:00:00.000Z',
    candidateAt: '2026-10-09T12:00:00.001Z',
    nowMs: NOW,
  }), { status: 'expired', reason: 'observations are more than 24 hours apart' })
})

test('clock compares absolute instants and permits reversed recording order', () => {
  const result = assessFieldWindow({
    baselineAt: CANDIDATE,
    candidateAt: BASELINE,
    nowMs: NOW,
  })
  assert.equal(result.status, 'within-window')
  assert.equal(result.elapsedMinutes, 1440)
})

test('second retailer not yet recorded is PENDING, never eligible', () => {
  const result = assessFieldWindow({
    baselineAt: '2026-10-10T21:00:00Z',
    nowMs: NOW,
  })
  assert.deepEqual(result, { status: 'pending', remainingMinutes: 1320 })
})

test('missing second retailer beyond 24 hours is expired even if baseline is valid', () => {
  assert.equal(assessFieldWindow({ baselineAt: BASELINE, nowMs: NOW }).status, 'expired')
})

test('future-dated baseline or candidate is invalid regardless of time span', () => {
  const next = '2099-01-01T12:00:00Z'
  assert.equal(assessFieldWindow({ baselineAt: next, candidateAt: next, nowMs: NOW }).status, 'invalid')
  assert.equal(assessFieldWindow({ baselineAt: BASELINE, candidateAt: next, nowMs: NOW }).status, 'invalid')
  assert.equal(assessFieldWindow({ baselineAt: BASELINE, candidateAt: CANDIDATE, nowMs: NaN }).status, 'invalid')
})

test('CLI rendering never echoes timestamps or invents proof', () => {
  const messages = []
  const exit = main(['--baseline', BASELINE, '--candidate', CANDIDATE], (message) => messages.push(message), NOW)
  assert.equal(exit, 0)
  assert.equal(messages.length, 1)
  assert.match(messages[0], /does not validate.*savings claim/)
  assert.doesNotMatch(messages[0], /2026|10:00:00|\u20ac/)
})

test('incomplete CLI exits nonzero and says it is pending', () => {
  const messages = []
  const exit = main(['--baseline', '2026-10-10T22:00:00Z'], (message) => messages.push(message), NOW)
  assert.equal(exit, 2)
  assert.match(messages[0], /PENDING/)
  assert.doesNotMatch(messages[0], /2026/)
})

test('real Node entrypoint accepts observed historical timestamps but rejects malformed arguments', () => {
  const script = resolve('scripts/m3-field-window-preflight.mjs')
  const valid = spawnSync(process.execPath, [script, '--baseline', BASELINE, '--candidate', CANDIDATE], { encoding: 'utf8' })
  assert.equal(valid.status, 0, valid.stderr)
  assert.match(valid.stdout, /WINDOW ONLY/)
  const invalid = spawnSync(process.execPath, [script, '--baseline', '2099-01-01T00:00:00Z', '--candidate', CANDIDATE], { encoding: 'utf8' })
  assert.equal(invalid.status, 1)
  assert.match(invalid.stdout, /NOT READY/)
  const malformed = spawnSync(process.execPath, [script, '--candidate', CANDIDATE], { encoding: 'utf8' })
  assert.equal(malformed.status, 1)
  assert.match(malformed.stderr, /usage:/)
})

test('M3 clock uses elapsed hours rather than wall-clock labels through DST transitions', () => {
  const later = Date.parse('2026-12-01T12:00:00Z')
  const spring = assessFieldWindow({
    baselineAt: '2026-03-28T12:00:00+01:00',
    candidateAt: '2026-03-29T12:00:00+02:00',
    nowMs: later,
  })
  assert.deepEqual(spring, { status: 'within-window', elapsedMinutes: 1380 })

  const autumn = assessFieldWindow({
    baselineAt: '2026-10-24T12:00:00+02:00',
    candidateAt: '2026-10-25T12:00:00+01:00',
    nowMs: later,
  })
  assert.equal(autumn.status, 'expired', 'same displayed hour on consecutive dates can be 25 elapsed hours')
})

test('M3 clock permits exact 24-hour cross-zone equality but refuses UTC-hidden futures', () => {
  const later = Date.parse('2026-12-01T12:00:00Z')
  assert.equal(assessFieldWindow({
    baselineAt: '2026-10-23T22:00:00-05:00',
    candidateAt: '2026-10-25T03:00:00Z',
    nowMs: later,
  }).status, 'within-window')

  const hiddenFuture = '2026-10-10T20:30:00-05:00'
  assert.equal(assessFieldWindow({
    baselineAt: hiddenFuture, candidateAt: hiddenFuture, nowMs: NOW,
  }).status, 'invalid')
})

test('M3 field clock handles century leap-year rules without coercion', () => {
  assert.equal(parseFieldInstant('1900-02-29T00:00:00Z'), null)
  assert.equal(parseFieldInstant('2000-02-29T00:00:00Z'),
    Date.parse('2000-02-29T00:00:00Z'))
})

test('pending operator guidance includes a safe, rounded-up countdown', () => {
  const logs = []
  const exitCode = main(
    ['--baseline', '2026-10-10T22:00:00.001Z'],
    (message) => logs.push(message),
    NOW,
  )
  assert.equal(exitCode, 2)
  assert.equal(logs.length, 1)
  assert.match(logs[0], /PENDING: DekaMarkt/)
  assert.match(logs[0], /23 uur en 1 minuten over/)
  assert.match(logs[0], /Nog geen besparingsbewijs/)
  assert.doesNotMatch(logs[0], /2026|22:00:00|PLUS|\u20ac/)
})

test('less than one minute at deadline never incorrectly reports zero minutes left', () => {
  const logs = []
  const clock = Date.parse('2026-10-10T23:59:59.999Z')
  const result = assessFieldWindow({
    baselineAt: '2026-10-09T00:00:00Z',
    nowMs: clock,
  })
  assert.deepEqual(result, {
    status: 'expired',
    reason: '24-hour window has elapsed; recollect both stores',
  })

  const justInside = assessFieldWindow({
    baselineAt: '2026-10-09T23:59:59.999Z',
    nowMs: clock,
  })
  assert.equal(justInside.status, 'pending')
  assert.equal(justInside.remainingMinutes, 1)
  const exitCode = main(
    ['--baseline', '2026-10-09T23:59:59.999Z'],
    message => logs.push(message),
    clock,
  )
  assert.equal(exitCode, 2)
  assert.match(logs[0], /0 uur en 1 minuten over/)
})

test('at exactly the first-store deadline pending stays nonclaimable', () => {
  const cutoff = Date.parse('2026-10-10T23:00:00Z')
  const expected = assessFieldWindow({ baselineAt: '2026-10-09T23:00:00Z', nowMs: cutoff })
  assert.deepEqual(expected, { status: 'pending', remainingMinutes: 0 })
  assert.equal('claimable' in expected, false)
})
