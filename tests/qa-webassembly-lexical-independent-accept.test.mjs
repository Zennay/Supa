import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair QA #1001 on exact frozen lexical-owner candidate.
// Parse synthetic TypeScript snippets with the actual guard; do not execute
// WebAssembly, snippets, simulated imports or candidate runtime functions.
const text = readFileSync(new URL('./production-webassembly-execution-boundary.test.mjs', import.meta.url), 'utf8')
const begin = text.indexOf('const browserRoots =')
const end = text.indexOf('\nasync function listProductionSources(', begin)
assert.ok(begin >= 0 && end > begin, 'actual AST guard source required')
const { findWebAssemblyExecution } = new Function(
  'ts', 'path',
  text.slice(begin, end) + '\nreturn { findWebAssemblyExecution }',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1001 independent: lexical bindings in nested functions and blocks do not fake browser execution', () => {
  for (const source of [
    'function simulate(WebAssembly) { const run = WebAssembly.compile; }',
    'const fake = { WebAssembly: { compile() {} } }; { const { WebAssembly } = fake; WebAssembly.instantiate(bytes) }',
    'function simulate(window) { return window.WebAssembly.instantiate(bytes) }',
    'const local = (globalThis) => globalThis.WebAssembly.instantiate(bytes)',
    'try { risky() } catch (window) { window.WebAssembly.compile(bytes) }',
  ]) {
    assert.equal(findWebAssemblyExecution(source), null, source)
  }
})

test('QA #1001 independent: genuine globals become visible again outside the local shadow', () => {
  for (const source of [
    '{ let WebAssembly = mock; WebAssembly.compile(bytes) }\nWebAssembly.compile(bytes)',
    'function local(window) { window.WebAssembly.instantiate(bytes) }\nwindow.WebAssembly.compile(bytes)',
    'try {} catch (WebAssembly) { WebAssembly.compile(bytes) }\nnew WebAssembly.Module(bytes)',
    'function inner(globalThis) { globalThis.WebAssembly.compile(bytes) }\nglobalThis.WebAssembly.instantiate(bytes)',
  ]) {
    assert.ok(findWebAssemblyExecution(source), source)
  }
})

test('QA #1001 independent: real browser roots and computed WebAssembly members are still rejected', () => {
  for (const source of [
    'WebAssembly["compile"](bytes)',
    'window["WebAssembly"]["compileStreaming"](response)',
    'new globalThis.WebAssembly["Module"](bytes)',
    'self.WebAssembly.instantiateStreaming(response)',
    'const exposed = (WebAssembly)',
    'const { Module } = globalThis.WebAssembly',
  ]) {
    const result = findWebAssemblyExecution(source)
    assert.ok(result, source)
    assert.ok(result.kind && result.text, source)
  }
})

test('QA #1001 independent: inert reference strings and safe nonexecuting object members remain valid', () => {
  for (const source of [
    '"WebAssembly.compile(bytes)"',
    '// window.WebAssembly.compile(bytes)',
    'const example = runtime.WebAssembly.compile',
    'WebAssembly.Memory',
    'WebAssembly.Table',
    'const example = { WebAssembly: { Module: 1 } }',
  ]) {
    assert.equal(findWebAssemblyExecution(source), null, source)
  }
})

test('QA #1001 independent: TSX source is statically analyzed with mixed local and global paths', () => {
  const text = [
    'const preview = <span>not running candidates</span>',
    'function local(WebAssembly) { return WebAssembly.compile(bytes) }',
    'globalThis.WebAssembly.instantiate(bytes)',
  ].join('\n')
  const result = findWebAssemblyExecution(text, 'fixture.tsx')
  assert.ok(result)
  assert.match(result.text, /WebAssembly/)
})
