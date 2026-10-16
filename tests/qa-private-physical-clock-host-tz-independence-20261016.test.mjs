import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))

// Run the same physical chronology contract in genuinely separate Node
// processes. Date's host timezone must never influence civil UTC evidence.
const program = [
  "import { physicalCaptureNanoseconds, samePhysicalCaptureInstant } from './scripts/retailer-physical-civil-clock.mjs'",
  "const clocks = [",
  "  '0001-01-01T00:00:00.000000001+14:00',",
  "  '0099-12-31T23:59:59.999999999-12:00',",
  "  '1900-03-01T00:00:00.000000001Z',",
  "  '1969-12-31T23:59:59.999999999Z',",
  "  '1970-01-01T00:00:00Z',",
  "  '2000-02-29T23:59:59.123456789+05:45',",
  "  '2026-10-04T18:08:57.837123456Z',",
  "  '2026-10-04T20:08:57.837123456+02:00',",
  "  '9999-12-31T23:59:59.999999999-12:00',",
  "  '2026-10-04T18:08:57.837123456-13:00',",
  "  '2026-10-04T18:08:57.837123456-00:00',",
  "  '2026-02-29T18:08:57.837123456Z',",
  "]",
  "const nanos = clocks.map(clock => {",
  "  const value = physicalCaptureNanoseconds(clock)",
  "  return value === null ? null : String(value)",
  "})",
  "const aliases = [",
  "  samePhysicalCaptureInstant(clocks[6], clocks[7]),",
  "  samePhysicalCaptureInstant(clocks[6], clocks[9]),",
  "  samePhysicalCaptureInstant(clocks[6], clocks[10]),",
  "]",
  "console.log(JSON.stringify({ nanos, aliases }))",
].join('\n')

test('physical source chronology is byte-identical under six server-local timezone settings', () => {
  const zones = [
    'UTC',
    'Europe/Amsterdam',
    'America/New_York',
    'Asia/Kathmandu',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
  ]
  let expected
  for (const TZ of zones) {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
      cwd: root,
      env: { ...process.env, TZ },
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 65536,
    })
    assert.equal(result.error, undefined, TZ)
    assert.equal(result.status, 0, `Node worker in ${TZ}: ${result.stderr}`)
    assert.equal(result.stderr, '', TZ)
    const observation = JSON.parse(result.stdout)
    assert.equal(observation.nanos.length, 12, TZ)
    assert.equal(observation.nanos[4], '0', 'UNIX epoch')
    assert.equal(observation.nanos[6], observation.nanos[7], 'equivalent ISO offsets')
    assert.deepEqual(observation.nanos.slice(9), [null, null, null], 'impossible clocks')
    assert.deepEqual(observation.aliases, [true, false, false], 'physical identity')
    if (expected === undefined) expected = observation
    else assert.deepEqual(observation, expected, `TZ-dependent chronology at ${TZ}`)
  }
})
