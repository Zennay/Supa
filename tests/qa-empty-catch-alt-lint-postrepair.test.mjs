import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair review for the real empty-catch AST contract.
// Synthetic source snippets only; unrelated to production persistence or M3.
const text = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const begin = text.indexOf('function scriptKindFor(')
const end = text.indexOf("\ntest('production source contains", begin)
assert.ok(begin >= 0 && end > begin, 'QA guard must exist on frozen source parent')
const { findUndocumentedEmptyCatch } = new Function('ts', 'path',
  text.slice(begin, end) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 postrepair: alternative formatter/linters alone are not an explanation', () => {
  for (const directive of [
    'biome-ignore lint/style/noUnusedTemplateLiteral',
    'BIOME-IGNORE lint/suspicious/noEmptyBlockStatements',
    'deno-lint-ignore no-empty',
    'deno-lint-ignore-file no-empty',
    'oxlint-disable no-empty',
    'oxlint-enable no-empty',
    'oxlint-disable-next-line no-empty',
    'prettier-ignore',
  ]) {
    const code = 'try { save() } catch { /* ' + directive + ' */ }'
    assert.ok(findUndocumentedEmptyCatch(code), directive)
  }
})

test('QA #1000 postrepair: actual recovery explanation survives next to directive', () => {
  for (const explanation of [
    'Storage is intentionally optional when private mode denies access.',
    'Opslag kan niet beschikbaar zijn, dus sessiestatus blijft in geheugen.',
    '次の操作でローカル状態を復元します。',
  ]) {
    const code = [
      'try { save() } catch {',
      '  // prettier-ignore',
      '  /* ' + explanation + ' */',
      '}',
    ].join('\n')
    assert.equal(findUndocumentedEmptyCatch(code), null, explanation)
  }
})

test('QA #1000 postrepair: a directive buried in nested catch does not hide missing rationale', () => {
  const code = [
    'try {',
    '  try { save() } catch { /* biome-ignore lint/suspicious/noEmptyBlockStatements */ }',
    '} catch { /* Browser storage denial can be ignored for this volatile session. */ }',
  ].join('\n')
  const finding = findUndocumentedEmptyCatch(code, 'nested.ts')
  assert.ok(finding)
  assert.equal(finding.line, 2)
})

test('QA #1000 postrepair: documented empty catch and nonempty recovery remain legal', () => {
  const cases = [
    'try { save() } catch { /* Session remains usable after a storage error. */ }',
    'try { save() } catch { return null }',
    'try { save() } catch (error) { throw error }',
    'try { save() } catch { /* Deno lint does not control browser storage; we deliberately use volatile session state. */ }',
  ]
  for (const candidate of cases) {
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})
