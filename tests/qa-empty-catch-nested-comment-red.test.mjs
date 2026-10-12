import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 independent new synthetic expected-RED: explanations inside an
// uninvoked nested callback do not explain the surrounding swallowed error.
const text = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = text.indexOf('function scriptKindFor(')
const end = text.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function('ts', 'path',
  text.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 RED: prose nested in an uninvoked arrow cannot justify silent outer catch', () => {
  for (const sample of [
    'try { fail() } catch (error) { () => { /* Retry the cache if it is available later. */ }; }',
    'try { fail() } catch { void (() => { // Optional cache will retry later.\n }); }',
  ]) {
    assert.ok(inspect(sample), sample)
  }
})

test('QA #1000 RED: prose in an uncalled local function cannot justify silent outer catch', () => {
  for (const sample of [
    'try { fail() } catch { function later() { /* Error has a fallback when called. */ } }',
    'try { fail() } catch { async function later() { // Retry on next render.\n return true; } }',
  ]) {
    assert.ok(inspect(sample), sample)
  }
})

test('QA #1000 positive: catch-level rationale counts and real immediate recovery remains allowed', () => {
  for (const sample of [
    'try { fail() } catch { /* Ignore optional cache errors and keep state in memory. */ function later() {} }',
    'try { fail() } catch { // Cache read failure is nonfatal.\n void (() => 1); }',
    'try { fail() } catch (error) { (() => recover(error))(); }',
    'try { fail() } catch (error) { function later() { return recover(error) } later(); }',
  ]) {
    assert.equal(inspect(sample), null, sample)
  }
})
