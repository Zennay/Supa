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

function bindingIdentifierNames(name, names = []) {
  if (!name) return names
  if (ts.isIdentifier(name)) {
    names.push(name.text)
    return names
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingIdentifierNames(element.name, names)
    }
  }
  return names
}

function nearestBindingScope(node, blockScoped = true) {
  let current = node.parent
  while (current) {
    if (
      ts.isSourceFile(current) ||
      ts.isFunctionLike(current) ||
      (blockScoped && (
        ts.isBlock(current) ||
        ts.isModuleBlock(current) ||
        ts.isCatchClause(current)
      ))
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

function collectLocalBindingScopes(sourceFile) {
  const scopesByName = new Map()

  function register(scope, name) {
    if (!scope) return
    for (const identifier of bindingIdentifierNames(name)) {
      const scopes = scopesByName.get(identifier) ?? new Set()
      scopes.add(scope)
      scopesByName.set(identifier, scopes)
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause) {
      register(sourceFile, node.importClause.name)
      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        register(sourceFile, bindings.name)
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) register(sourceFile, element.name)
      }
    }

    if (ts.isParameter(node)) {
      register(nearestBindingScope(node, false), node.name)
    }

    if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const declarationList = node.parent
      const blockScoped = ts.isVariableDeclarationList(declarationList) &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0
      register(nearestBindingScope(node, blockScoped), node.name)
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name
    ) {
      register(nearestBindingScope(node, true), node.name)
    }

    if (
      (ts.isFunctionExpression(node) || ts.isClassExpression(node)) &&
      node.name
    ) {
      register(node, node.name)
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      register(node, node.variableDeclaration.name)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return scopesByName
}

function isLocallyBoundIdentifier(node, scopesByName) {
  if (!ts.isIdentifier(node)) return false
  const scopes = scopesByName.get(node.text)
  if (!scopes) return false

  let current = node.parent
  while (current) {
    if (scopes.has(current)) return true
    current = current.parent
  }
  return false
}

function isBrowserRoot(node, localBindings) {
  const current = unwrapExpression(node)
  return (
    ts.isIdentifier(current) &&
    browserRoots.has(current.text) &&
    !isLocallyBoundIdentifier(current, localBindings)
  )
}

function isWebAssemblyObject(node, localBindings) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return (
      current.text === 'WebAssembly' &&
      !isLocallyBoundIdentifier(current, localBindings)
    )
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  return (
    isBrowserRoot(current.expression, localBindings) &&
    memberName(current) === 'WebAssembly'
  )
}

function webAssemblyMember(node, localBindings) {
  const current = unwrapExpression(node)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return null
  }
  if (!isWebAssemblyObject(current.expression, localBindings)) return null
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

  const localBindings = collectLocalBindingScopes(sourceFile)
  let finding = null

  function visit(node) {
    if (finding) return

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isWebAssemblyObject(node.initializer, localBindings)
    ) {
      finding = {
        kind: 'WebAssembly namespace alias',
        text: node.getText(sourceFile),
      }
      return
    }

    if (ts.isCallExpression(node)) {
      const name = webAssemblyMember(node.expression, localBindings)
      if (name && executableMethods.has(name)) {
        finding = {
          kind: 'WebAssembly.' + name + ' call',
          text: node.expression.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isNewExpression(node)) {
      const name = webAssemblyMember(node.expression, localBindings)
      if (name && executableConstructors.has(name)) {
        finding = {
          kind: 'WebAssembly.' + name + ' construction',
          text: node.expression.getText(sourceFile),
        }
        return
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = webAssemblyMember(node, localBindings)
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

test('WebAssembly boundary respects locally bound runtime names', () => {
  for (const source of [
    "const WebAssembly = runtime.WebAssembly; WebAssembly.compile(bytes)",
    "function compile(WebAssembly) { WebAssembly.instantiate(bytes) }",
    "import WebAssembly from './runtime'; new WebAssembly.Module(bytes)",
    "const window = runtime; window.WebAssembly.compile(bytes)",
    "function run(globalThis) { globalThis.WebAssembly.instantiate(bytes) }",
    "try {} catch (WebAssembly) { WebAssembly.compile(bytes) }",
  ]) {
    assert.equal(findWebAssemblyExecution(source), null, source)
  }
})

test('WebAssembly boundary keeps local shadowing scoped', () => {
  for (const source of [
    "{ const WebAssembly = runtime.WebAssembly; WebAssembly.compile(bytes) }\nWebAssembly.compile(bytes)",
    "function local(window) { window.WebAssembly.compile(bytes) }\nwindow.WebAssembly.compile(bytes)",
    "try {} catch (WebAssembly) { WebAssembly.compile(bytes) }\nWebAssembly.instantiate(bytes)",
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
