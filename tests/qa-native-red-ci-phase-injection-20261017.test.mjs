/**
 * Independent QA1: a native TAP failure is evidence only inside the test
 * phase, between the native root header and its plan/summary. Synthetic
 * GitHub job logs only; no production data or release certification.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const OWNED = 'qa-native-red-ci-phase-injection-20261017.test.mjs'
const PREFIX = '2026-10-17T04:35:41.1234567Z '
const fail = [
  'not ok 1 - intentionally failing owned synthetic QA',
  '  ---',
  "  location: '/home/runner/work/Supa/Supa/tests/" + OWNED + ":21:2'",
  '  failureType: testCodeFailure',
  '  ...',
]
const header = ['TAP version 13']
const totals = [
  'ok 2 - unrelated successful control',
  '1..2', '# tests 2', '# pass 1', '# fail 1',
  '# skipped 0', '# cancelled 0', '# todo 0',
]
const terminal = '##[error]Process completed with exit code 1.'
const opts = { expectedRed: 1, allowedTestFiles: [OWNED] }
const build = lines => lines.map(line => PREFIX + line).join('\n') + '\n'
const valid = () => [ ...header, ...fail, ...totals, terminal ]
function refuse(lines) {
  assert.throws(() => analyzeNativeRedCi(build(lines), opts),
    /TAP|failure|native|completion|envelope|unexpected|phase|position|log/i)
}

test('control: true native test failure before plan can be classified only as expected RED', () => {
  const result = analyzeNativeRedCi(build(valid()), opts)
  assert.equal(result.outcome, 'expected-qa-red-only')
  assert.deepEqual(result.byFile, {[OWNED]: 1})
  assert.equal(result.productionReady, false)
  assert.equal(result.productionBuild, 'not-proven-by-red-node')
})

test('control: unrelated GitHub post-job cleanup lines are allowed, not TAP evidence', () => {
  const result = analyzeNativeRedCi(build([...valid(), 'Post job cleanup.', 'Cleaning up orphan processes']), opts)
  assert.equal(result.fail, 1)
  assert.equal(result.productionReady, false)
})

test('expected RED: a matching failure emitted before root TAP header is not a native test', () => {
  refuse([...fail, ...header, ...totals, terminal])
})

test('expected RED: a matching failure emitted during pretest setup is not a native test', () => {
  refuse(['Run npm ci', 'added 70 packages', ...fail, ...header, ...totals, terminal])
})

test('expected RED: a matching failure after the completed TAP summary is not owned native evidence', () => {
  refuse([...header, ...totals, ...fail, terminal])
})

test('expected RED: matching failure in post-job cleanup after terminal exit cannot backfill TAP counts', () => {
  refuse([...header, ...totals, terminal, 'Post job cleanup.', ...fail])
})

test('standalone CLI emits no affirmative JSON for post-terminal forged failure', () => {
  const script = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))
  const proc = spawnSync(process.execPath, [
    script, '--expected-red=1', '--allow=' + OWNED,
  ], { input: build([...header, ...totals, terminal, ...fail]),
    encoding: 'utf8', timeout: 15000 })
  assert.equal(proc.error, undefined)
  assert.equal(proc.status, 2)
  assert.equal(proc.stdout, '')
  assert.match(proc.stderr, /Unverified native CI evidence/)
})
