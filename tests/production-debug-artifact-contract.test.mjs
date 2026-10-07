import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])

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

function bindingContainsName(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected

  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.some((element) => (
      ts.isBindingElement(element) &&
      bindingContainsName(element.name, expected)
    ))
  }

  return false
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

function collectConsoleBindingScopes(sourceFile) {
  const scopes = new Set()

  function register(scope, name) {
    if (scope && bindingContainsName(name, 'console')) scopes.add(scope)
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

    if (ts.isVariableDeclaration(node)) {
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
      node.name?.text === 'console'
    ) {
      scopes.add(node)
    }

    if (ts.isCatchClause(node) && node.variableDeclaration) {
      register(node, node.variableDeclaration.name)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return scopes
}

function isLocallyBoundConsole(node, consoleBindingScopes) {
  if (!ts.isIdentifier(node) || node.text !== 'console') return false

  let current = node.parent
  while (current) {
    if (consoleBindingScopes.has(current)) return true
    current = current.parent
  }

  return false
}

function isGlobalConsoleObject(node, consoleBindingScopes) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return (
      current.text === 'console' &&
      !isLocallyBoundConsole(current, consoleBindingScopes)
    )
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return (
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'globalThis' &&
      memberName(current) === 'console'
    )
  }

  return false
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

function findForbiddenProductionDiagnostic(source, filename = 'candidate.tsx') {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filename),
  )
  const consoleBindingScopes = collectConsoleBindingScopes(sourceFile)

  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isDebuggerStatement(node)) {
      finding = {
        kind: 'debugger statement',
        text: node.getText(sourceFile),
      }
      return
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isGlobalConsoleObject(node.initializer, consoleBindingScopes)
    ) {
      finding = {
        kind: 'console alias',
        text: node.getText(sourceFile),
      }
      return
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (
        isGlobalConsoleObject(node, consoleBindingScopes) ||
        isGlobalConsoleObject(node.expression, consoleBindingScopes)
      ) {
        finding = {
          kind: 'console access',
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

test('production source contains no console or debugger statements', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findForbiddenProductionDiagnostic(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains a forbidden ' +
        (finding?.kind ?? 'production diagnostic') + ': ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('production diagnostic guard catches executable console and debugger syntax', () => {
  for (const source of [
    "console.log('debug')",
    "console['error']('debug')",
    "globalThis.console.warn('debug')",
    "globalThis['console']['log']('debug')",
    'const emit = console.info',
    'const globalConsole = globalThis.console',
    'const debugConsole = console',
    'const parenthesizedConsole = (console)',
    'const { log } = console',
    'const { error: emitError } = (console as Console)',
    "{ const console = logger; console.log('ok') }\nconsole.warn('debug')",
    'debugger;',
  ]) {
    assert.ok(findForbiddenProductionDiagnostic(source), source)
  }
})

test('production diagnostic guard ignores comments, strings and unrelated loggers', () => {
  for (const source of [
    "// console.log('example')",
    "const example = \"debugger; console.error('example')\"",
    "const logger = { console: { log() {} } }; logger.console.log()",
    "const debugConsole = logger.console",
    "const { log } = logger.console",
    "const consoleLike = { log() {} }; consoleLike.log('ok')",
  ]) {
    assert.equal(findForbiddenProductionDiagnostic(source), null, source)
  }
})

test('production diagnostic guard respects locally bound console identifiers', () => {
  for (const source of [
    "const console = { log() {} }; console.log('ok')",
    "let console = logger; console.warn('ok')",
    "var console = logger; console.error('ok')",
    "function render(console) { console.log('ok') }",
    "function render() { const console = logger; console.info('ok') }",
    "if (ready) { const console = logger; console.log('ok') }",
    "const { console } = logger; console.log('ok')",
    "import console from './logger'; console.log('ok')",
    "import { console } from './logger'; console.log('ok')",
    "import * as console from './logger'; console.log('ok')",
    "try {} catch (console) { console.error('ok') }",
  ]) {
    assert.equal(findForbiddenProductionDiagnostic(source), null, source)
  }
})
