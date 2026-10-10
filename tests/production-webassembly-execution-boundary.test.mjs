import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const executableMethods = new Set([
  'compile',
  'compileStreaming',
  'instantiate',
  'instantiateStreaming',
])
const executableConstructors = new Set(['Instance', 'Module'])

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticName(node.expression)
  return null
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node)) return staticName(node.argumentExpression)
  return null
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function isWebAssemblyObject(node) {
  const current = unwrapExpression(node)
  if (ts.isIdentifier(current)) return current.text === 'WebAssembly'

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    memberName(current) === 'WebAssembly'
  )
}

function webAssemblyMember(node) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null
  }
  if (!isWebAssemblyObject(current.expression)) return null
  return memberName(current)
}

function scriptKindFor(filename) {
  switch (path.extname(filename)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.jsx':
      return ts.ScriptKind.JSX
    case '.js':
      return ts.ScriptKind.JS
    default:
      return ts.ScriptKind.TS
  }
}

function findWebAssemblyExecution(source, filename = 'candidate.ts') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )

  let finding = null

  function visit(node) {
    if (finding) return

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isWebAssemblyObject(node.initializer)
    ) {
      finding = {
        kind: 'WebAssembly namespace alias',
        text: node.getText(sourceFile),
      }
      return
    }

    if (ts.isCallExpression(node)) {
      const name = webAssemblyMember(node.expression)
      if (name && executableMethods.has(name)) {
        finding = {
          kind: 'WebAssembly.' + name + ' call',
          text: node.expression.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isNewExpression(node)) {
      const name = webAssemblyMember(node.expression)
      if (name && executableConstructors.has(name)) {
        finding = {
          kind: 'WebAssembly.' + name + ' construction',
          text: node.expression.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = webAssemblyMember(node)
      if (
        name &&
        (executableMethods.has(name) || executableConstructors.has(name))
      ) {
        finding = {
          kind: 'WebAssembly executable runtime reference',
          text: node.getText(sourceFile),
        }
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

async function listProductionSources(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = relative ? path.join(relative, entry.name) : entry.name
    const childUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)

    if (entry.isDirectory()) {
      files.push(...await listProductionSources(childUrl, childRelative))
      continue
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ relativePath: childRelative, url: childUrl })
    }
  }

  return files
}

test('production source has no unreviewed WebAssembly execution paths', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findWebAssemblyExecution(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains unreviewed WebAssembly execution: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('WebAssembly boundary catches compilation and execution primitives', () => {
  for (const source of [
    'WebAssembly.compile(bytes)',
    "window['WebAssembly']['compileStreaming'](response)",
    'globalThis.WebAssembly.instantiate(bytes)',
    'self.WebAssembly.instantiateStreaming(response)',
    'const compile = WebAssembly.compile',
    'const instantiate = window.WebAssembly.instantiate',
    'new WebAssembly.Module(bytes)',
    "new globalThis['WebAssembly']['Instance'](module)",
    'const ModuleCtor = self.WebAssembly.Module',
    'const wasm = WebAssembly',
    'const wasm = (window.WebAssembly)',
    "const wasm = (globalThis['WebAssembly'] as typeof WebAssembly)",
    'const { compile } = self.WebAssembly',
  ]) {
    assert.ok(findWebAssemblyExecution(source), source)
  }
})

test('WebAssembly boundary preserves inert text and non-execution local APIs', () => {
  for (const source of [
    "const example = 'WebAssembly.compile(bytes)'",
    '// WebAssembly.instantiate(bytes)',
    'runtime.WebAssembly.compile(bytes)',
    'compiler.instantiate(bytes)',
    'new runtime.Module(bytes)',
    'WebAssembly.Memory',
    'WebAssembly.Table',
    'const wasm = runtime.WebAssembly',
    'const wasm = { compile() {}, instantiate() {} }',
    'const webAssemblySupported = true',
  ]) {
    assert.equal(findWebAssemblyExecution(source), null, source)
  }
})
