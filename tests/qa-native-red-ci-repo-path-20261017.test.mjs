/**
 * QA1 exact-repository-root provenance for GitHub-hosted native TAP failures.
 * Synthetic logs only. Source-owned QA #3748 at frozen 4505a7e6d311.
 * Report outcome remains expected-qa-red-only, never production readiness.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const OWNED = 'qa-synthetic-repo-path-20261017.test.mjs'
const STAMP = '2026-10-17T04:04:12.1012345Z '
const opts = {expectedRed: 1, allowedTestFiles: [OWNED]}
const actualPath = '/home/runner/work/Supa/Supa/tests/' + OWNED + ':27:3'

function fullLog(path = actualPath) {
  const log = [
    'TAP version 13',
    'not ok 1 - synthetic owned failing TAP',
    '  ---',
    "  location: '" + path + "'",
    "  failureType: 'testCodeFailure'",
    '  ...',
    'ok 2 - unrelated clean control',
    '1..2',
    '# tests 2', '# pass 1', '# fail 1',
    '# skipped 0', '# cancelled 0', '# todo 0',
    '##[error]Process completed with exit code 1.',
  ]
  return log.map(line => STAMP + line).join('\n') + '\n'
}

const refused = path => assert.throws(
  () => analyzeNativeRedCi(fullLog(path), opts),
  /location|source|repository|native TAP|Failure outside/i,
  'location outside exact checked-in Supa tests root: ' + path,
)

test('control: actual GitHub-hosted Supa repo root identifies owned QA failure', () => {
  const report = analyzeNativeRedCi(fullLog(), opts)
  assert.equal(report.fail, 1)
  assert.deepEqual(report.byFile, {[OWNED]: 1})
  assert.equal(report.productionReady, false)
})

test('expected RED: basename collision from a different GitHub repository is not owned Supa QA', () => {
  refused('/home/runner/work/Other/Other/tests/' + OWNED + ':27:3')
})

test('expected RED: third-party node_modules shadow of test basename cannot certify QA', () => {
  refused('/home/runner/work/Supa/Supa/node_modules/lib/tests/' + OWNED + ':27:3')
})

test('expected RED: nested unrelated fixture shadow cannot spoof a checked-in QA test root', () => {
  refused('/home/runner/work/Supa/Supa/tests/fixtures/' + OWNED + ':27:3')
})

test('expected RED: arbitrary file URI is not a native local test checkout', () => {
  refused('https://not-supa.invalid/Supa/Supa/tests/' + OWNED + ':27:3')
})

test('expected RED: relative tests/ filename without verified checkout root must not certify failure', () => {
  refused('tests/' + OWNED + ':27:3')
})

test('expected RED: malformed non-positive source coordinates cannot certify native failure', () => {
  refused('/home/runner/work/Supa/Supa/tests/' + OWNED + ':0:0')
})

test('standalone CLI refuses an out-of-repo location with no stdout or private data', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    script, '--expected-red=1', '--allow=' + OWNED,
  ], {input: fullLog('/home/runner/work/Other/Other/tests/' + OWNED + ':27:3'),
    encoding: 'utf8', timeout: 15000})
  assert.equal(result.error, undefined)
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unverified native CI evidence/)
})
