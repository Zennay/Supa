/**
 * Independent M3 CI evidence provenance controls. Synthetic GitHub job logs;
 * no retailer HTTP, field captures, source rights, or production claims.
 *
 * Frozen independent QA proof-tool owner: PR #3707. These deliberately failing
 * expectations document incomplete hosted terminal/TAP envelope validation.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const OWNED = 'qa-synthetic-terminal-integrity-20261017.test.mjs'
const OPTIONS = Object.freeze({ expectedRed: 1, allowedTestFiles: [OWNED] })
const STAMP = '2026-10-17T03:42:22.1234567Z '
const END = '##[error]Process completed with exit code 1.'

function hostedLog() {
  return [
    'TAP version 13',
    '# Subtest: synthetic owned quality gate',
    'not ok 1 - synthetic owned quality gate',
    '  ---',
    "  location: '/home/runner/work/Supa/Supa/tests/" + OWNED + ":18:3'",
    "  failureType: 'testCodeFailure'",
    '  ...',
    'ok 2 - original unrelated regression',
    'ok 3 - original source rights hold',
    '1..3',
    '# tests 3',
    '# pass 2',
    '# fail 1',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    END,
  ].map(line => STAMP + line).join('\n') + '\n'
}

test('control: a complete synthetic hosted RED envelope produces only an explicitly non-release report', () => {
  const outcome = analyzeNativeRedCi(hostedLog(), OPTIONS)
  assert.equal(outcome.outcome, 'expected-qa-red-only')
  assert.equal(outcome.fail, 1)
  assert.equal(outcome.pass, 2)
  assert.deepEqual(outcome.byFile, { [OWNED]: 1 })
  assert.equal(outcome.productionReady, false)
  assert.equal(outcome.sourcePermissionGate, 'not-proven-by-red-node')
  assert.equal(outcome.productionBuild, 'not-proven-by-red-node')
})

test('expected RED: a log without the hosted terminal failure cannot be certified as exact native CI', () => {
  const missingExit = hostedLog().replace(STAMP + END + '\n', '')
  assert.notEqual(missingExit, hostedLog())
  assert.throws(() => analyzeNativeRedCi(missingExit, OPTIONS),
    /terminal|completion|exit|unverified|incomplete/i)
})

test('expected RED: a standalone TAP fragment without a native plan cannot be certified as a full job', () => {
  const missingPlan = hostedLog().replace(STAMP + '1..3\n', '')
  assert.notEqual(missingPlan, hostedLog())
  assert.throws(() => analyzeNativeRedCi(missingPlan, OPTIONS),
    /TAP|plan|incomplete|unverified/i)
})

test('control: a different hosted exit code or unrelated Actions error must never be approved', () => {
  for (const violation of [
    hostedLog().replace(END, '##[error]Process completed with exit code 2.'),
    hostedLog() + STAMP + '##[error]Checkout verification failed\n',
    hostedLog().replace(OWNED + ':18:3', 'product-owner.test.mjs:18:3'),
  ]) assert.throws(() => analyzeNativeRedCi(violation, OPTIONS))
})

test('expected RED: standalone proof CLI must not print verified-looking JSON for an incomplete hosted job', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const forged = hostedLog().replace(STAMP + END + '\n', '')
  const processResult = spawnSync(process.execPath, [
    script, '--expected-red=1', '--allow=' + OWNED,
  ], { input: forged, encoding: 'utf8', timeout: 15000 })
  assert.equal(processResult.error, undefined)
  assert.equal(processResult.status, 2, 'unverified hosted result must fail closed')
  assert.equal(processResult.stdout, '', 'no positive-looking evidence on stdout')
  assert.match(processResult.stderr, /Unverified native CI evidence/)
})

test('expected RED: missing native TAP v13 signature must refuse a detached synthetic fragment', () => {
  const forged = hostedLog().replace(STAMP + 'TAP version 13\n', '')
  assert.notEqual(forged, hostedLog())
  assert.throws(() => analyzeNativeRedCi(forged, OPTIONS), /TAP|incomplete|unverified/i)
})

test('expected RED: multiple top-level TAP plans cannot certify one native test run', () => {
  const forged = hostedLog().replace(STAMP + '1..3\n',
    STAMP + '1..3\n' + STAMP + '1..3\n')
  assert.notEqual(forged, hostedLog())
  assert.throws(() => analyzeNativeRedCi(forged, OPTIONS), /TAP|plan|ambiguous|unverified/i)
})

test('expected RED: terminal GitHub marker before TAP summary cannot certify completed execution', () => {
  const forged = hostedLog().replace(STAMP + END + '\n', '')
    .replace(STAMP + '# tests 3\n', STAMP + END + '\n' + STAMP + '# tests 3\n')
  assert.notEqual(forged, hostedLog())
  assert.throws(() => analyzeNativeRedCi(forged, OPTIONS),
    /terminal|completion|TAP|unverified|incomplete/i)
})

test('expected RED: duplicated native terminal exit cannot certify one exact hosted job', () => {
  const forged = hostedLog() + STAMP + END + '\n'
  assert.throws(() => analyzeNativeRedCi(forged, OPTIONS),
    /duplicate|terminal|ambiguous|unverified/i)
})
