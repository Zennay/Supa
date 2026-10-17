/**
 * Independent quality-validation for the hosted CI job log's raw UTF-8 wire
 * integrity. Synthetic TAP only. No production release or retailer evidence.
 * Frozen completed-envelope QA parent: #3745 at 416fa624c5e79aa6.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const FILE = 'qa-synthetic-utf8-transport-20261017.test.mjs'
const OPTIONS = { expectedRed: 1, allowedTestFiles: [FILE] }
const STAMP = '2026-10-17T03:59:22.1234567Z '
const TERMINAL = '##[error]Process completed with exit code 1.'
const CLI = fileURLToPath(new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url))

const stamp = lines => lines.map(line => STAMP + line).join('\n') + '\n'
const valid = () => stamp([
  'TAP version 13',
  '# Subtest: synthetic independent CI transport',
  'not ok 1 - synthetic source integrity failure',
  '  ---',
  "  location: '/home/runner/work/Supa/Supa/tests/" + FILE + ":22:1'",
  "  failureType: 'testCodeFailure'",
  '  ...',
  'ok 2 - untouched canonical permission hold',
  '1..2',
  '# tests 2',
  '# pass 1',
  '# fail 1',
  '# cancelled 0',
  '# skipped 0',
  '# todo 0',
  TERMINAL,
])
const cli = bytes => spawnSync(process.execPath, [
  CLI, '--expected-red=1', '--allow=' + FILE,
], { input: bytes, encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 })

function refuseWire(bytes, reason) {
  const result = cli(bytes)
  assert.equal(result.error, undefined, reason)
  assert.equal(result.status, 2, 'malformed raw CI bytes must not become positive proof: ' + reason)
  assert.equal(result.stdout, '', 'invalid raw log cannot emit verified-looking JSON')
  assert.match(result.stderr, /Unverified native CI evidence/)
  assert.doesNotMatch(result.stderr, /synthetic independent|source integrity|Supa\/tests/)
}

test('positive: complete Unicode GitHub log is preserved and never claims production readiness', () => {
  const good = valid() + stamp(['Post job cleanup: café 👩‍🍳 हिन्दी', 'No retailer network calls'])
  const native = analyzeNativeRedCi(good, OPTIONS)
  assert.deepEqual(native.byFile, { [FILE]: 1 })
  assert.equal(native.productionReady, false)
  assert.equal(native.sourcePermissionGate, 'not-proven-by-red-node')
  assert.equal(native.productionBuild, 'not-proven-by-red-node')
  const result = cli(Buffer.from(good, 'utf8'))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).productionReady, false)
})

test('expected RED: invalid UTF-8 lead byte in a post-step cannot disappear as replacement glyph', () => {
  refuseWire(Buffer.concat([Buffer.from(valid()), Buffer.from([0xff])]), 'stray FF after terminal')
})

test('expected RED: overlong UTF-8 in an ignored GitHub comment cannot be normalized silently', () => {
  const bytes = Buffer.concat([
    Buffer.from(stamp(['##[group]metadata '])),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from('\n' + valid(), 'utf8'),
  ])
  refuseWire(bytes, 'overlong UTF-8 before native TAP')
})

test('expected RED: incomplete multibyte scalar after the summary cannot be accepted', () => {
  refuseWire(Buffer.concat([Buffer.from(valid(), 'utf8'), Buffer.from([0xf0, 0x9f, 0x91])]),
    'truncated four-byte scalar')
})

test('expected RED: encoded UTF-16 surrogate must not be accepted as corrupt runner metadata', () => {
  refuseWire(Buffer.concat([Buffer.from(valid()), Buffer.from([0xed, 0xa0, 0x80])]),
    'encoded surrogate')
})

test('expected RED: programmatic log strings must reject lone UTF-16 surrogates before proof', () => {
  assert.throws(() => analyzeNativeRedCi(valid() + '\ud800', OPTIONS),
    /UTF-16|Unicode|malformed|invalid/i)
  assert.throws(() => analyzeNativeRedCi(valid() + '\udc00', OPTIONS),
    /UTF-16|Unicode|malformed|invalid/i)
})
