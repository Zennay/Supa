import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair review for #1000 on frozen #1913. Only the actual
// TypeScript AST guard is evaluated, not any candidate exception handler.
const contract = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const begin = contract.indexOf('function scriptKindFor(')
const end = contract.indexOf("\ntest('production source contains", begin)
assert.ok(begin >= 0 && end > begin)
const { findUndocumentedEmptyCatch } = new Function('ts', 'path',
  contract.slice(begin, end) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: one or multiple semicolon-only catches fail closed', () => {
  for (const candidate of [
    'try { save() } catch { ; }',
    'try { save() } catch (error) { ; ; ; }',
    'try { save() } catch { ; /* TODO fix later */ ; }',
    'try { save() } catch { /* eslint-disable no-empty */ ; }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 independent: nested statement-free braces fail closed', () => {
  for (const candidate of [
    'try { save() } catch { {} }',
    'try { save() } catch { { {} } }',
    'try { save() } catch { ; { ; { ; } } }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 independent: explanatory comments are still permitted around no-ops', () => {
  for (const candidate of [
    'try { save() } catch { ; /* Private browsing forbids persistence; local state is volatile. */ }',
    'try { save() } catch { { // Opslag geweigerd, checklist blijft tijdelijk.\n ; } }',
    'try { save() } catch { /* 不能写入浏览器存储，保留会话状态 */ {;} }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})

test('QA #1000 independent: real recovery nested in empty blocks remains accepted', () => {
  for (const candidate of [
    'try { save() } catch { { ; return fallback } }',
    'try { save() } catch { ; { throw new Error("storage failed") } }',
    'try { save() } catch (error) { ; if (error) throw error }',
    'try { save() } catch { /* rationale */ }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})

test('QA #1000 independent: nested no-op catch reports correct TSX line, no execution', () => {
  const candidate = [
    'const view = <div>Safe view</div>',
    'try { risky() } catch { /* Browser storage unavailable; continue in-memory */ }',
    'try {',
    '  throw Error("do not evaluate candidate")',
    '} catch (error) {',
    '  { ; { ; } }',
    '}',
  ].join('\n')
  const finding = findUndocumentedEmptyCatch(candidate, 'fixture.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 5)
  assert.ok(finding.text.includes('catch (error)'))
})
