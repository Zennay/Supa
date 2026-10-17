/**
 * QA1: a path in some *other* checkout which happens to end in
 * Supa/Supa/tests is not the GitHub-native Supa workspace.
 * Pure synthetic TAP, no remote, retailer, user or release evidence.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const OWNED = 'qa-native-red-ci-exact-checkout-20261017.test.mjs'
const opts = { expectedRed: 1, allowedTestFiles: [OWNED] }
const linux = '/home/runner/work/Supa/Supa/tests/' + OWNED + ':16:2'
const windows = 'D:\\a\\Supa\\Supa\\tests\\' + OWNED + ':16:2'
const log = source => [
  'TAP version 13',
  'not ok 1 - one synthetic QA failure', '  ---',
  "  location: '" + source + "'", '  failureType: testCodeFailure',
  '  ...',
  'ok 2 - successful control', '1..2',
  '# tests 2', '# pass 1', '# fail 1',
  '# skipped 0', '# cancelled 0', '# todo 0',
  '##[error]Process completed with exit code 1.',
].map(x => '2026-10-17T05:12:00.001345Z ' + x).join('\n') + '\n'
const refuse = source => assert.throws(
  () => analyzeNativeRedCi(log(source), opts),
  /location|origin|repository|native|foreign|checkout|failure/i,
)

test('control: actual hosted Linux root test origin still counts only expected RED', () => {
  const result = analyzeNativeRedCi(log(linux), opts)
  assert.equal(result.outcome, 'expected-qa-red-only')
  assert.equal(result.productionReady, false)
  assert.deepEqual(result.byFile, { [OWNED]: 1 })
})
test('control: standard GitHub-hosted Windows root checkout path remains supported', () => {
  const result = analyzeNativeRedCi(log(windows), opts)
  assert.equal(result.outcome, 'expected-qa-red-only')
  assert.equal(result.productionReady, false)
})

test('expected RED: foreign /tmp checkout with matching Supa suffix is not hosted Supa', () => {
  refuse('/tmp/foreign/Supa/Supa/tests/' + OWNED + ':16:2')
})
test('expected RED: different GitHub work repository can nest an identical Supa suffix', () => {
  refuse('/home/runner/work/Other/Other/Supa/Supa/tests/' + OWNED + ':16:2')
})
test('expected RED: nested copied Supa within original checkout cannot masquerade as repository root', () => {
  refuse('/home/runner/work/Supa/Supa/fixtures/Supa/Supa/tests/' + OWNED + ':16:2')
})
test('expected RED: home directory clone with identical test path suffix is not native runner root', () => {
  refuse('/home/runner/Supa/Supa/tests/' + OWNED + ':16:2')
})
test('expected RED: foreign Windows work path with canonical suffix is not native runner root', () => {
  refuse('D:\\a\\Other\\Other\\Supa\\Supa\\tests\\' + OWNED + ':16:2')
})
test('expected RED: alternate Windows drive workspace folder must not certify root tests', () => {
  refuse('C:\\tmp\\Supa\\Supa\\tests\\' + OWNED + ':16:2')
})
test('expected RED: mismatched hosted repository casing is not checked-in root origin', () => {
  refuse('/home/runner/work/supa/Supa/tests/' + OWNED + ':16:2')
})
test('standalone CLI refuses foreign suffix with empty stdout (no false affirmative evidence)', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const proc = spawnSync(process.execPath, [
    script, '--expected-red=1', '--allow=' + OWNED,
  ], { input: log('/tmp/foreign/Supa/Supa/tests/' + OWNED + ':16:2'),
    encoding: 'utf8', timeout: 15000 })
  assert.equal(proc.error, undefined)
  assert.equal(proc.status, 2)
  assert.equal(proc.stdout, '')
  assert.match(proc.stderr, /Unverified native CI evidence/)
})
