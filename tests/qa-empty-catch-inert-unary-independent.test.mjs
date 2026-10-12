import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent QA #1000 on the source-only guard repair: only TypeScript AST
// analysis is executed. None of the synthetic candidate snippets run.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function(
  'ts', 'path', source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })
const caught = statement => 'try { risky() } catch (error) { ' + statement + ' }'

test('QA #1000 independent: nested void, unary and parentheses remain inert without rationale', () => {
  for (const statement of [
    'void 0;',
    'void (true);',
    'void ((!false));',
    '!((null));',
    '~~1;',
    '-(-2);',
    '-1n;',
    'void (void "ignored");',
    '{ void 0; { !!false; ; } }',
    'debugger; void 0;',
  ]) {
    assert.ok(inspect(caught(statement)), statement)
  }
})

test('QA #1000 independent: mixed no-op and lint-only catch is not silently accepted', () => {
  for (const statement of [
    'void 0; !true;',
    '/* TODO: add handling */ void false;',
    '// eslint-disable-next-line no-empty\n void 0;',
    '{ debugger; void /regex/g; }',
  ]) {
    assert.ok(inspect(caught(statement)), statement)
  }
})

test('QA #1000 independent: real effectful operands and genuine documented catches remain valid', () => {
  for (const statement of [
    'void recovery(error);',
    'void obj.property;',
    'void counter++;',
    '!recover();',
    '~getValue();',
    '+makeNumber();',
    'handle(error);',
    'void 0; return fallback;',
    'void 0; throw error;',
    // Unary plus BigInt throws rather than computing; conservatively keep it
    // in the non-inert class instead of claiming a no-op without proof.
    '+1n;',
  ]) {
    assert.equal(inspect(caught(statement)), null, statement)
  }
  for (const statement of [
    '/* Local storage may deny writes; edits remain session-only. */ void 0;',
    '// The optional cache is best-effort; no user data is cleared.\n !false;',
  ]) {
    assert.equal(inspect(caught(statement)), null, statement)
  }
})

test('QA #1000 independent: TSX line precision and first unsupported catch remain stable', () => {
  const script = [
    'const ui = <section>safe</section>',
    'try { risky() } catch { /* This is best-effort only. */ void 0; }',
    'const next = 42',
    'try { risky() } catch (error) {',
    '  void ((!false));',
    '}',
    'try { risky() } catch { !true; }',
  ].join('\n')
  const finding = inspect(script, 'fixture.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 4)
  assert.match(finding.text, /catch \(error\)/)
})
