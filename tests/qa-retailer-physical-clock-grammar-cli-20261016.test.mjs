import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import {
  physicalCaptureNanoseconds as nanos,
  samePhysicalCaptureInstant as same,
} from '../scripts/retailer-physical-civil-clock.mjs'

// Additional independent opt-in CLI/grammar acceptance on frozen product #3715.
// No client data, retailer DNS/HTTP, current prices, or source permission grants.
const VALID = '2026-10-04T18:08:57.837123456Z'

function run(...args) {
  return spawnSync(process.execPath, [
    'scripts/retailer-physical-civil-clock-cli.mjs', ...args,
  ], { encoding: 'utf8', timeout: 4000 })
}
function safeResult(result, status) {
  assert.equal(result.error, undefined)
  assert.equal(result.status, status, result.stderr)
  assert.equal(result.stderr, '')
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.reviewed, false)
  assert.equal(summary.sourceRightsVerified, false)
  assert.equal(Object.values(summary).every(value => typeof value === 'boolean'), true)
  return summary
}

test('refuse noncanonical civil ISO spellings instead of lenient Date.parse normalization', () => {
  const invalid = [
    '2026-10-04 18:08:57Z',
    '2026-10-04t18:08:57z',
    '2026-10-04T18:08:57',
    '2026-10-04T18:08:57+14',
    '2026-10-04T18:08:57+14:01',
    '2026-10-04T18:08:57-12:01',
    '2026-10-04T18:08:57-00:00',
    '2026-10-04T18:08:57+00:60',
    '2026-10-04T18:08:57.1234567890Z',
    '2026-10-04T18:08:57.123456789Z ',
    '2026-10-04T18:08:57.123456789Z\n',
    '2026-10-04T18:08:57.123456789Z\u0000',
    '2026-10-04T18:08:57.123456789Z\u202e',
    '2026-10-04T18:08:57.123456789Z?access_token=fictional',
    '2026-02-30T12:00:00Z',
    '1900-02-29T12:00:00Z',
  ]
  for (const value of invalid) {
    assert.equal(nanos(value), null, JSON.stringify(value))
    assert.equal(same(VALID, value), false, JSON.stringify(value))
  }
})

test('fractional scale 0 through 9 digits preserves canonical nanosecond ordering', () => {
  const whole = '2026-10-04T18:08:57'
  const baseline = nanos(whole + 'Z')
  assert.equal(typeof baseline, 'bigint')
  assert.equal(nanos(whole + '.000000000Z'), baseline)
  for (let digits = 1; digits <= 9; digits++) {
    const fraction = '1'.padEnd(digits, '0')
    const current = nanos(whole + '.' + fraction + 'Z')
    assert.equal(current - baseline, 100_000_000n,
      'leading decimal 0.1 second must not change as precision grows')
    assert.equal(same(whole + '.' + fraction + 'Z',
      whole + '.100000000+00:00'), true)
  }
  assert.equal(nanos(whole + '.000000001Z') - baseline, 1n)
  assert.equal(nanos(whole + '.999999999Z') - baseline, 999_999_999n)
  assert.equal(same(whole + '.1Z', whole + '.100000001Z'), false)
})

test('hostile values cannot execute coercions, proxy traps, or private Date functions', () => {
  let touched = 0
  const p = new Proxy({}, {
    get() { touched++; throw Error('should-not-run') },
    getPrototypeOf() { touched++; throw Error('should-not-run') },
  })
  const x = {
    [Symbol.toPrimitive]() { touched++; throw Error('should-not-run') },
    toString() { touched++; throw Error('should-not-run') },
  }
  const date = new Date()
  date.getTime = () => { touched++; throw Error('should-not-run') }
  for (const value of [p, x, date, new String(VALID), 0, false, null, undefined, 1n]) {
    assert.equal(nanos(value), null)
    assert.equal(same(VALID, value), false)
    assert.equal(same(value, VALID), false)
  }
  assert.equal(touched, 0)
})

test('operator reports only inert booleans, does not echo hostile ISO data, and refuses rights claims', () => {
  const good = safeResult(run('--check', VALID), 0)
  assert.deepEqual(good, {validCivilNotation: true, reviewed: false, sourceRightsVerified: false})
  const unknown = '2026-10-04T18:08:57-00:00'
  assert.deepEqual(safeResult(run('--check', unknown), 1), {
    validCivilNotation: false, reviewed: false, sourceRightsVerified: false,
  })
  const bad = '2026-10-04T18:08:57-13:00?access_token=fictional'
  const denied = run('--same', VALID, bad)
  assert.deepEqual(safeResult(denied, 1), {
    validCivilNotation: false, samePhysicalInstant: false,
    reviewed: false, sourceRightsVerified: false,
  })
  assert.equal((denied.stdout + denied.stderr).includes(bad), false)
  const erroneousFlags = run('--check', VALID, '--source-rights-approved')
  assert.equal(erroneousFlags.status, 2)
  assert.equal(erroneousFlags.stdout, '')
  assert.doesNotMatch(erroneousFlags.stderr, /access_token|2026-10|true/)
})
