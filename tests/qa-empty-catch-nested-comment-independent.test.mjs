import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent synthetic QA #1000 postrepair acceptance. Snippets are only
// parsed by the actual TypeScript AST guard; none of them are executed.
const guard = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = guard.indexOf('function scriptKindFor(')
const end = guard.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const check = new Function(
  'ts', 'path', guard.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: file => file.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: no outer rationale arises from uncalled nested body prose', () => {
  for (const example of [
    'try { fetchCache() } catch { function later() { /* Safe fallback once called. */ } }',
    'try { fetchCache() } catch { async function later() { // Fallback after await.\n } }',
    'try { fetchCache() } catch { void (() => { /* Retry on demand. */ }); }',
    'try { fetchCache() } catch { (() => { // Delay refresh.\n return 1; }); }',
    'try { fetchCache() } catch { function* later() { /* Stream on next tick. */ } }',
  ]) {
    assert.ok(check(example), example)
  }
})

test('QA #1000 independent: comments directly in the catch remain valid even near callbacks', () => {
  for (const example of [
    'try { fetchCache() } catch { /* A missing optional cache is safe to ignore. */ function later() {} }',
    'try { fetchCache() } catch { function later() {} /* Cache remains best effort only. */ }',
    'try { fetchCache() } catch { // We keep local session changes without persistence.\n (() => 1); }',
    'try { fetchCache() } catch { /* Opslag kan tijdelijk geweigerd zijn. */ void (() => 1); }',
    'try { fetchCache() } catch (e) { (() => repair(e))(); }',
  ]) {
    assert.equal(check(example), null, example)
  }
})

test('QA #1000 independent: independent nested catch inspection and TSX outer line position', () => {
  const example = [
    'const view = <div>ready</div>',
    'try { fetchCache() } catch { // Optional cache errors are handled in memory.\n',
    '  function deferred() {',
    '    try { anotherRisk() } catch { /* TODO: add recovery */ }',
    '  }',
    '}',
  ].join('\n')
  const finding = check(example, 'fixture.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 4)
  assert.match(finding.text, /catch \{ \/\* TODO/)
})
