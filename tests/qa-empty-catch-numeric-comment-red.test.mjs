import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

// Independent expected-RED on frozen QA #1861. Exercise its actual guard,
// without rewriting or exporting original owner code. Never execute fixtures.
const source = readFileSync(
  new URL('./production-empty-catch-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const findUndocumentedEmptyCatch = new Function(
  'ts', 'path',
  source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, path)

test('QA #1000: numeric-only catch comments are not explanations [expected RED]', () => {
  for (const note of ['42', '0', '2026', '404', '123456789']) {
    const input = `try { risky() } catch { /* ${note} */ }`
    assert.ok(findUndocumentedEmptyCatch(input, 'fixture.ts'), note)
  }
})

test('QA #1000: number-only line comment cannot justify an empty catch [expected RED]', () => {
  const input = 'try { risky() } catch { // 500\n }'
  assert.ok(findUndocumentedEmptyCatch(input, 'fixture.tsx'))
})

test('QA #1000: numeric-only nested catch remains undocumented [expected RED]', () => {
  const input = [
    'function handle() {',
    '  try {',
    '    try { work() } catch { /* 503 */ }',
    '  } catch (outer) { return fallback() }',
    '}',
  ].join('\n')
  const finding = findUndocumentedEmptyCatch(input, 'fixture.ts')
  assert.ok(finding)
  assert.equal(finding.line, 3)
})

test('QA #1000: genuine handling prose and nonempty catch behavior stay accepted', () => {
  for (const fixture of [
    'try { risky() } catch { /* HTTP 503; browser storage is disabled, use session state. */ }',
    'try { risky() } catch { // A revoked localStorage port is expected.\n }',
    'try { risky() } catch { return fallback() }',
    'try { risky() } catch { throw new Error("unrecoverable") }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(fixture, 'fixture.ts'), null, fixture)
  }
})
