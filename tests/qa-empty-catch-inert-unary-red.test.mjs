import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000: execute ONLY the TypeScript-AST catch contract on synthetic source.
// Candidate bodies are parsed, NEVER executed; no production JS evaluated.
const contract = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const begin = contract.indexOf('function scriptKindFor(')
const end = contract.indexOf("\ntest('production source contains", begin)
assert.ok(begin !== -1 && end > begin)
const inspect = new Function(
  'ts', 'path', contract.slice(begin, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })
function candidate(statement) {
  return 'try { unsafe() } catch { ' + statement + '; }'
}

test('QA #1000 expected RED: void of inert literals cannot excuse a swallowed exception', () => {
  for (const statement of [
    'void 0',
    'void null',
    'void true',
    'void (false)',
    'void ((42))',
    'void "text"',
    'void (/regex/u)',
  ]) {
    assert.ok(inspect(candidate(statement)), statement)
  }
})

test('QA #1000 expected RED: unary literal no-ops cannot count as recovery', () => {
  for (const statement of [
    '!true', '!0', '~1', '+1', '-2', '-1n', '!!false',
    '!((null))', 'void (!0)',
  ]) {
    assert.ok(inspect(candidate(statement)), statement)
  }
})

test('QA #1000 control: potentially effective unary operations and real recovery stay permitted', () => {
  for (const statement of [
    'void notify(error)',
    '!recover()',
    '+getNumber()',
    '~readValue()',
    'handle(error)',
    'throw new Error("caught")',
    'void counter++',
  ]) {
    assert.equal(inspect(candidate(statement)), null, statement)
  }
  assert.equal(
    inspect(candidate('/* No storage access in privacy mode; keep session only. */ void 0')),
    null,
    'a genuine explanation is still valid',
  )
})
