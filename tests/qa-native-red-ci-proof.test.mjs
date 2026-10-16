import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { analyzeNativeRedCi } from '../scripts/qa-native-red-ci-proof.mjs'

const A = 'qa-retailer-bare-url-delimiter-provenance-20261016.test.mjs'
const B = 'qa-six-adapter-negative-utc-civil-floor-20261016.test.mjs'
const FILES = [A, B]

function githubLog({ paths = [A, A, B, B], pass = 6, skipped = 0,
                     cancelled = 0, todo = 0, extra = [] } = {}) {
  const stamp = line => '2026-10-16T22:41:23.8761234Z ' + line
  const lines = ['TAP version 13']
  for (let i = 0; i < paths.length; i++) {
    lines.push('# Subtest: independent reviewed source mutation ' + i)
    lines.push('not ok ' + (i + 1) + ' - independent reviewed source mutation ' + i)
    lines.push('  ---')
    if (paths[i] !== null) lines.push("  location: '/home/runner/work/Supa/Supa/tests/" + paths[i] + ":40:9'")
    lines.push("  failureType: 'testCodeFailure'")
    lines.push('  ...')
  }
  for (let i = 0; i < pass; i++) {
    lines.push('ok ' + (paths.length + i + 1) + ' - historical sanitized M1 private positive')
  }
  lines.push('1..' + (paths.length + pass))
  for (const [key, count] of Object.entries({
    tests: paths.length + pass + skipped + cancelled,
    pass, fail: paths.length, cancelled, skipped, todo,
  })) lines.push('# ' + key + ' ' + count)
  lines.push('##[error]Process completed with exit code 1.')
  lines.push(...extra)
  return lines.map(stamp).join('\n')
}

test('independent QA1 RED verifier counts only four exact known test failures, not build proof', () => {
  const report = analyzeNativeRedCi(githubLog(), {
    expectedRed: 4, allowedTestFiles: FILES,
  })
  assert.deepEqual(report.byFile, { [A]: 2, [B]: 2 })
  assert.equal(report.outcome, 'expected-qa-red-only')
  assert.equal(report.tests, 10)
  assert.equal(report.pass, 6)
  assert.equal(report.fail, 4)
  assert.equal(report.unexpectedFailures, 0)
  assert.equal(report.productionReady, false)
  assert.equal(report.sourcePermissionGate, 'not-proven-by-red-node')
  assert.equal(report.productionBuild, 'not-proven-by-red-node')
})

test('hosted non-QA failures and absent file locations cannot be waved away as intended RED', () => {
  for (const paths of [[A, A, B, 'product-core.test.mjs'], [A, A, B, null]]) {
    assert.throws(() => analyzeNativeRedCi(githubLog({ paths }), {
      expectedRed: 4, allowedTestFiles: FILES,
    }), /Failure outside/)
  }
})

test('expected RED count, missing suite, extra raw failures and corrupt summary are rejected', () => {
  for (const [log, expected] of [
    [githubLog(), 3],
    [githubLog({ paths: [A, A, A, A] }), 4],
    [githubLog({ paths: [A, A, B, B, B] }), 4],
    [githubLog().replace('# pass 6', '# pass 5'), 4],
    [githubLog().replace('# fail 4', '# fail 3'), 4],
    [githubLog().replace('# tests 10', '# tests 11'), 4],
    [githubLog().replace('# cancelled 0', ''), 4],
    [githubLog() + '\n# fail 4', 4],
    [githubLog({ skipped: 1 }), 4],
    [githubLog({ cancelled: 1 }), 4],
    [githubLog({ todo: 1 }), 4],
  ]) {
    assert.throws(() => analyzeNativeRedCi(log, {
      expectedRed: expected, allowedTestFiles: FILES,
    }))
  }
})

test('GitHub Actions errors unrelated to TAP fail closed even with matching failing test filenames', () => {
  const log = githubLog({ extra: ['##[error]Checkout of untrusted revision failed'] })
  assert.throws(() => analyzeNativeRedCi(log, {
    expectedRed: 4, allowedTestFiles: FILES,
  }), /Non-test/)
})

test('rejects oversized, invalid and duplicate allowlists before inspecting evidence', () => {
  for (const options of [
    { expectedRed: 0, allowedTestFiles: FILES },
    { expectedRed: Number.MAX_SAFE_INTEGER + 1, allowedTestFiles: FILES },
    { expectedRed: 4, allowedTestFiles: [] },
    { expectedRed: 4, allowedTestFiles: [A, A] },
    { expectedRed: 4, allowedTestFiles: ['../' + A] },
    { expectedRed: 4, allowedTestFiles: ['bad.js'] },
  ]) assert.throws(() => analyzeNativeRedCi(githubLog(), options))
  assert.throws(() => analyzeNativeRedCi('x'.repeat(12 * 1024 * 1024 + 1), {
    expectedRed: 4, allowedTestFiles: FILES,
  }), /bounded/)
})

test('offline CLI accepts bounded piped native log, returns aggregate proof without source contents', () => {
  const script = new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url)
  const result = spawnSync(process.execPath, [
    script.pathname, '--expected-red=4', '--allow=' + A, '--allow=' + B,
  ], { input: githubLog(), encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
  const proof = JSON.parse(result.stdout)
  assert.equal(proof.fail, 4)
  assert.equal(proof.productionReady, false)
  assert.doesNotMatch(result.stdout, /https?:\/\/|\/home\/runner|password|capture token/i)
})

test('offline CLI does not produce counterfeit positive proof when log fails validation', () => {
  const script = new URL('../scripts/qa-native-red-ci-proof.mjs', import.meta.url)
  const result = spawnSync(process.execPath, [
    script.pathname, '--expected-red=4', '--allow=' + A, '--allow=' + B,
  ], { input: githubLog({ paths: [A, A, A, A] }), encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Unverified native CI evidence/)
})
