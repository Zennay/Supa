import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 synthetic RED: comments must be lexical comments, not delimiters
// embedded within inert string or static template literal values.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function('ts', 'path',
  source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: file => file.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 RED: a string holding a fake block comment does not document a catch', () => {
  for (const script of [
    'try { unsafe() } catch { "/* Ignore optional cache failure and keep local state. */"; }',
    "try { unsafe() } catch { '/* We can safely retry on another day. */'; }",
  ]) {
    assert.ok(inspect(script), script)
  }
})

test('QA #1000 RED: a static template holding a fake line comment is not rationale', () => {
  for (const script of [
    'try { unsafe() } catch { `// A previous cache will remain valid.`; }',
    'try { unsafe() } catch { `/* Deliberately ignore error because the UI uses memory. */`; }',
  ]) {
    assert.ok(inspect(script), script)
  }
})

test('QA #1000 positive: actual catch-level source comments and calls remain accepted', () => {
  for (const script of [
    'try { unsafe() } catch { /* This read is best effort only; keep local state. */ "/* fake */"; }',
    'try { unsafe() } catch { // Keep the last safe version after read failure.\n `/* fake */`; }',
    'try { unsafe() } catch (error) { recover(error); }',
    'try { unsafe() } catch { throw new Error("cache unavailable"); }',
  ]) {
    assert.equal(inspect(script), null, script)
  }
})
