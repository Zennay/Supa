/**
 * Independent QA1 regression: a native TAP failure must not be re-attributed
 * to an allowlisted QA file by a second, forged "location" line.
 *
 * Only synthetic hosted CI text; no price, real field, source rights, or
 * product source changes. Parent #3745 exact 0f3ad8b43974 frozen.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const QA = 'qa-synthetic-location-binding-20261017.test.mjs'
const FOREIGN = 'product-m3-price-integrity.test.mjs'
const stamp = text => '2026-10-17T04:01:01.1234567Z ' + text
const options = { expectedRed: 1, allowedTestFiles: [QA] }
const loc = (filename, line = 18) =>
  "  location: '/home/runner/work/Supa/Supa/tests/" + filename + ":" + line + ":5'"

function hosted(locations) {
  const lines = [
    'TAP version 13',
    'not ok 1 - synthetic native failure',
    '  ---',
    ...locations.map(path => loc(path)),
    "  failureType: 'testCodeFailure'",
    '  ...',
    'ok 2 - synthetic unchanged rights hold',
    '1..2', '# tests 2', '# pass 1', '# fail 1',
    '# cancelled 0', '# skipped 0', '# todo 0',
    '##[error]Process completed with exit code 1.',
  ]
  return lines.map(stamp).join('\n') + '\n'
}

test('control: a single native allowlisted location is classified only as expected QA RED', () => {
  const report = analyzeNativeRedCi(hosted([QA]), options)
  assert.equal(report.outcome, 'expected-qa-red-only')
  assert.deepEqual(report.byFile, { [QA]: 1 })
  assert.equal(report.productionReady, false)
  assert.equal(report.sourcePermissionGate, 'not-proven-by-red-node')
})

test('control: unrelated actual source failure with one foreign location is already rejected', () => {
  assert.throws(() => analyzeNativeRedCi(hosted([FOREIGN]), options),
    /Failure outside/)
})

test('expected RED: late allowlisted YAML location cannot overwrite an earlier product failure', () => {
  assert.throws(() => analyzeNativeRedCi(hosted([FOREIGN, QA]), options),
    /ambiguous|duplicate|location|Failure outside/i)
})

test('expected RED: duplicate same-filename location lines are ambiguous, not independent evidence', () => {
  assert.throws(() => analyzeNativeRedCi(hosted([QA, QA]), options),
    /ambiguous|duplicate|location/i)
})

test('control: an allowlisted location followed by a foreign location remains rejected', () => {
  assert.throws(() => analyzeNativeRedCi(hosted([QA, FOREIGN]), options),
    /ambiguous|duplicate|location|Failure outside/i)
})

test('expected RED: a second location outside the TAP diagnostic stanza cannot relabel failure', () => {
  const payload = hosted([FOREIGN]).replace(
    stamp('  ...') + '\n',
    stamp('  ...') + '\n' + stamp(loc(QA, 202)) + '\n',
  )
  assert.throws(() => analyzeNativeRedCi(payload, options),
    /ambiguous|duplicate|location|Failure outside/i)
})

test('expected RED: standalone CLI refuses conflicting origins without positive-looking JSON', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const child = spawnSync(process.execPath, [
    script, '--expected-red=1', '--allow=' + QA,
  ], {
    input: Buffer.from(hosted([FOREIGN, QA]), 'utf8'), encoding: 'utf8',
    timeout: 15000, maxBuffer: 128 * 1024,
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 2)
  assert.equal(child.stdout, '')
  assert.match(child.stderr, /Unverified native CI evidence/)
  assert.doesNotMatch(child.stderr, /product-m3-price|qa-synthetic-location/)
})
