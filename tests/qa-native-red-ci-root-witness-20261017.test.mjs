/**
 * Quality-validation 1/2: a synthetic TAP stream containing ONLY nested
 * subtests cannot establish that the GitHub native root suite actually ran.
 * All fixtures are made up and contain no production retailer data.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE = 'qa-native-red-ci-root-witness-20261017.test.mjs'
const ARGS = { expectedRed: 1, allowedTestFiles: [FILE] }
const STAMP = '2026-10-17T05:35:00.000011Z '
const location = "      location: '/home/runner/work/Supa/Supa/tests/" + FILE + ":12:5'"

function job(records) {
  return [
    'TAP version 13',
    ...records,
    '1..2',
    '# tests 2',
    '# pass 1',
    '# fail 1',
    '# skipped 0',
    '# cancelled 0',
    '# todo 0',
    '##[error]Process completed with exit code 1.',
  ].map(line => STAMP + line).join('\n') + '\n'
}

const rootFailure = ['not ok 1 - owned source failure', '  ---', location, '  ...']
const nestedFailure = ['    not ok 1 - nested but no root witness', '      ---', location, '      ...']

function verify(records) {
  return analyzeNativeRedCi(job(records), ARGS)
}

test('control: one root failure and one root success remain valid expected RED', () => {
  const result = verify([...rootFailure, 'ok 2 - root success'])
  assert.deepEqual([result.tests, result.pass, result.fail], [2, 1, 1])
  assert.equal(result.productionReady, false)
})

test('control: one root success may contain a nested owned failure', () => {
  const result = verify([...nestedFailure, 'ok 2 - root parent'])
  assert.equal(result.outcome, 'expected-qa-red-only')
  assert.equal(result.productionReady, false)
})

test('control: a root failure with nested success is still a valid compatibility case', () => {
  const result = verify([...rootFailure, '    ok 1 - nested success'])
  assert.equal(result.pass, 1)
  assert.equal(result.productionReady, false)
})

test('security: an all-nested failing and passing stream has no native root witness', () => {
  assert.throws(() => verify([...nestedFailure, '    ok 2 - nested success']), /root|TAP|witness|native|test/i)
})

test('security: reordered all-nested events cannot forge a native root witness', () => {
  assert.throws(() => verify(['    ok 2 - nested success', ...nestedFailure]), /root|TAP|witness|native|test/i)
})

test('CLI must not emit affirmative evidence for all-nested synthetic stream', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const child = spawnSync(process.execPath, [script, '--expected-red=1', '--allow=' + FILE], {
    input: job([...nestedFailure, '    ok 2 - nested success']),
    encoding: 'utf8',
    timeout: 15000,
  })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 2)
  assert.equal(child.stdout, '')
  assert.match(child.stderr, /Unverified native CI evidence/)
})
