import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Expected-RED on frozen QA #1000 actual empty-catch guard. A linter directive
// cannot stand in for an error-handling explanation; no production code edits.
const source = readFileSync(
  new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8',
)
const begin = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", begin)
assert.ok(begin >= 0 && end > begin)
const guard = new Function('ts', 'path',
  source.slice(begin, end) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: () => '.ts' }).findUndocumentedEmptyCatch

for (const directive of [
  'biome-ignore lint/suspicious/noEmptyBlockStatements',
  'deno-lint-ignore no-empty',
  'oxlint-disable no-empty',
  'prettier-ignore',
]) {
  test('QA #1000 expected RED: bare ' + directive.split(' ')[0] + ' does not explain swallowing failure', () => {
    const code = 'try { riskyStorage() } catch { /* ' + directive + ' */ }'
    assert.ok(guard(code, 'synthetic.ts'), directive)
  })
}

test('QA #1000: a real reason still documents the deliberately empty catch', () => {
  for (const explanation of [
    'Storage is optional in private browser mode.',
    'Opslag kan door de browser worden geweigerd; werk in het geheugen verder.',
    'The fallback UI remains active even if persistence fails.',
  ]) {
    const code = 'try { riskyStorage() } catch { /* ' + explanation + ' */ }'
    assert.equal(guard(code, 'synthetic.ts'), null, explanation)
  }
})

test('QA #1000: a lint directive plus separate genuine explanatory comment is accepted', () => {
  const source = 'try { riskyStorage() } catch { /* biome-ignore lint/suspicious/noEmptyBlockStatements */ /* Optional browser storage is best effort. */ }'
  assert.equal(guard(source, 'synthetic.ts'), null)
})
