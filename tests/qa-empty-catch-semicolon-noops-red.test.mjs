import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Expected-RED for #1000: EmptyStatement (';') and nested empty blocks do
// not constitute recovery from an exception. Exercise the actual AST guard
// without invoking any production catch handler or changing the application.
const sourceText = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const begin = sourceText.indexOf('function scriptKindFor(')
const end = sourceText.indexOf("\ntest('production source contains", begin)
assert.ok(begin >= 0 && end > begin, 'expected actual source guard')
const { findUndocumentedEmptyCatch } = new Function('ts', 'path',
  sourceText.slice(begin, end) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 RED: semicolon-only catches do not count as recovery', () => {
  for (const candidate of [
    'try { save() } catch { ; }',
    'try { save() } catch (err) { ;;; }',
    'try { save() } catch { ; /* TODO */ ; }',
    'try { save() } catch { ; // eslint-disable no-empty\n ; }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 RED: nested empty statement blocks are still no-ops', () => {
  for (const candidate of [
    'try { risky() } catch { {} }',
    'try { risky() } catch { { ; } }',
    'try { risky() } catch { ; { ; { ; } } }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 controls: documented catch and actual recovery remain valid', () => {
  for (const candidate of [
    'try { save() } catch { ; /* Browser storage is optional in privacy mode. */ }',
    'try { save() } catch { { ; } return fallback }',
    'try { save() } catch { { throw new Error("failure") } }',
    'try { save() } catch { /* Ignored because in-memory state remains usable. */ }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})
