import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair assurance for QA #1004, pinned to frozen owner.
// Extract the actual TypeScript AST predicate but never run a candidate.
const source = readFileSync(new URL('./production-dynamic-code-boundary.test.mjs', import.meta.url), 'utf8')
const begin = source.indexOf('const browserRoots =')
const end = source.indexOf('\nasync function listProductionSources(', begin)
assert.ok(begin >= 0 && end > begin)
const { findDynamicCodeExecution } = new Function(
  'ts', 'path',
  source.slice(begin, end) + '\nreturn { findDynamicCodeExecution }',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1004 independent: shadowed code-generation lookalikes remain local in nested scopes', () => {
  for (const candidate of [
    "function local(eval) { eval('text') }",
    "function local(Function) { return new Function('text') }",
    "const local = (window) => window.eval('text')",
    "function local(globalThis) { globalThis['Function']('text') }",
    "const local = (setTimeout) => setTimeout('text', 1)",
    "try {} catch (setInterval) { setInterval('text', 1) }",
    "const mock = { Function: () => 42 }; const { Function } = mock; Function('text')",
  ]) assert.equal(findDynamicCodeExecution(candidate), null, candidate)
})

test('QA #1004 independent: global eval/Function/string timers remain rejected after local bindings expire', () => {
  for (const candidate of [
    "function local(eval) { eval('local') }\neval('global')",
    "function local(Function) { Function('local') }\nnew Function('global')",
    "function local(window) { window.eval('local') }\nwindow.eval('global')",
    "function local(setTimeout) { setTimeout('local', 1) }\nsetTimeout('global', 1)",
    "try {} catch (setInterval) { setInterval('local', 1) }\nsetInterval('global', 1)",
  ]) assert.ok(findDynamicCodeExecution(candidate), candidate)
})

test('QA #1004 independent: computed browser-root strings and aliases fail closed', () => {
  for (const candidate of [
    "window['eval']('code')",
    "new globalThis['Function']('code')",
    "self.Function('code')",
    "const code = (0, eval)",
    "const Compiler = (globalThis.Function)",
    "globalThis.setTimeout('code', 10)",
    "self['setInterval']('code', 10)",
  ]) {
    const finding = findDynamicCodeExecution(candidate)
    assert.ok(finding, candidate)
    assert.ok(finding.kind && finding.text, candidate)
  }
})

test('QA #1004 independent: inert text and callback timers stay legal', () => {
  for (const candidate of [
    "const note = 'eval(1)'",
    "// Function('code')",
    "setTimeout(() => work(), 100)",
    "window.setInterval(() => work(), 100)",
    "runtime.eval('local code')",
    "const execute = runtime.eval",
    "const schedule = setTimeout",
  ]) assert.equal(findDynamicCodeExecution(candidate), null, candidate)
})

test('QA #1004 independent: TSX parsing retains a genuine global path beside a local shadow', () => {
  const candidate = [
    "const preview = <article>Passive UI</article>",
    "function locally(window) { window.eval('mock') }",
    "globalThis['eval']('should never execute')",
  ].join('\n')
  const finding = findDynamicCodeExecution(candidate, 'fixture.tsx')
  assert.ok(finding)
  assert.match(finding.text, /eval/)
})
