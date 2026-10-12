import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent, add-only QA #1000 acceptance against the actual parser.
// All fixtures are parsed as source text, never executed.
const guard = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = guard.indexOf('function scriptKindFor(')
const end = guard.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const find = new Function('ts', 'path',
  guard.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: fake comments in pure literals never explain a silent failure', () => {
  for (const body of [
    '"/* A fallback exists. */";',
    "'// An old cache will be reused.';",
    '`/* Cache is optional. */`;',
    '`// Retry at a later time.`;',
    'void ("/* Ignore this failure safely. */");',
    'void (`// The state is valid.`);',
  ]) {
    const code = `try { mayThrow() } catch { ${body} }`
    assert.ok(find(code), code)
  }
})

test('QA #1000 independent: genuine comments before or after inert literals are effective explanations', () => {
  for (const code of [
    'try { mayThrow() } catch { /* Missing optional cache is harmless here. */ "/* fake */"; }',
    'try { mayThrow() } catch { "// fake"; /* Preserve the last valid session state. */ }',
    'try { mayThrow() } catch { `/* fake */`; // No durable state changed after this failure.\n }',
    'try { mayThrow() } catch { // We keep all settings in memory until next change.\n void 0; }',
    'try { mayThrow() } catch (e) { recover(e); }',
  ]) {
    assert.equal(find(code), null, code)
  }
})

test('QA #1000 independent: real comments nested in deferred callbacks cannot explain outer catch', () => {
  const script = [
    'const app = <div>ready</div>',
    'try { mayThrow() } catch {',
    '  void (() => { /* Fallback is used only if function runs. */ });',
    '  `/* Cannot substitute for a source explanation. */`;',
    '}',
  ].join('\n')
  const finding = find(script, 'fixture.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 2)
})
