import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

const srcDir = new URL('../src/', import.meta.url)
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx'])
const browserRoots = new Set(['globalThis', 'self', 'window'])
const dynamicGlobals = new Set(['eval', 'Function'])
const stringTimerGlobals = new Set(['setInterval', 'setTimeout'])

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

  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    return unwrapExpression(current.right)
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

function isBrowserGlobalMember(node, expectedName, localBindings) {
  const current = unwrapExpression(node)

  if (ts.isIdentifier(current)) {
    return (
      current.text === expectedName &&
      !isLocallyBoundIdentifier(current, localBindings)
    )
  }

  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const base = unwrapExpression(current.expression)
  return (
    ts.isIdentifier(base) &&
    browserRoots.has(base.text) &&
    !isLocallyBoundIdentifier(base, localBindings) &&
    memberName(current) === expectedName
  )
}

function isStaticString(node) {
  if (!node) return false
  const current = unwrapExpression(node)
  return ts.isStringLiteralLike(current) || ts.isNoSubstitutionTemplateLiteral(current)
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

function findDynamicCodeExecution(source, filename = 'candidate.tsx') {
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

    if (ts.isVariableDeclaration(node) && node.initializer) {
      for (const globalName of dynamicGlobals) {
        if (isBrowserGlobalMember(node.initializer, globalName, localBindings)) {
          finding = {
            kind: globalName + ' capability alias',
            text: node.getText(sourceFile),
          }
          return
        }
      }
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const globalName of dynamicGlobals) {
        if (isBrowserGlobalMember(node.expression, globalName, localBindings)) {
          finding = {
            kind: globalName + ' runtime code generation',
            text: node.expression.getText(sourceFile),
          }
          return
        }
      }

      if (ts.isCallExpression(node) && isStaticString(node.arguments[0])) {
        for (const timerName of stringTimerGlobals) {
          if (isBrowserGlobalMember(node.expression, timerName, localBindings)) {
            finding = {
              kind: timerName + ' string execution',
              text: node.getText(sourceFile),
            }
            return
          }
        }
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

test('production source contains no direct runtime code generation', async () => {
  const files = await listProductionSources(srcDir)
  assert.ok(files.length > 0, 'expected at least one production source file')

  for (const file of files) {
    const source = await readFile(file.url, 'utf8')
    const finding = findDynamicCodeExecution(source, file.relativePath)

    assert.equal(
      finding,
      null,
      file.relativePath + ' contains forbidden dynamic code execution: ' +
        (finding?.kind ?? 'unknown primitive') + ' via ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('dynamic-code guard catches direct eval, Function constructors and string timers', () => {
  for (const source of [
    "eval('globalThis.compromised = true')",
    "(0, eval)('globalThis.compromised = true')",
    "globalThis['eval']('globalThis.compromised = true')",
    "window.eval('globalThis.compromised = true')",
    "Function('return globalThis')()",
    "new Function('return globalThis')",
    "new self['Function']('return globalThis')",
    "const execute = eval",
    "const execute = (window['eval'] as typeof eval)",
    "const Compiler = globalThis.Function",
    "const Compiler = (self['Function'])",
    "setTimeout('globalThis.compromised = true', 0)",
    "window['setInterval'](`globalThis.compromised = true`, 1000)",
  ]) {
    assert.ok(findDynamicCodeExecution(source), source)
  }
})

test('dynamic-code guard respects locally bound global-looking names', () => {
  for (const source of [
    "const eval = sandbox.eval; eval('local expression')",
    "function run(eval) { eval('local expression') }",
    "import evaluate from './sandbox'; const eval = evaluate; eval('local expression')",
    "const Function = factory.Function; new Function('local template')",
    "function build(Function) { Function('local template') }",
    "const setTimeout = scheduler.setTimeout; setTimeout('local task', 0)",
    "function schedule(setInterval) { setInterval('local task', 1000) }",
    "const window = sandbox; window.eval('local expression')",
    "function run(globalThis) { globalThis.Function('local template') }",
    "try {} catch (eval) { eval('local expression') }",
  ]) {
    assert.equal(findDynamicCodeExecution(source), null, source)
  }
})

test('dynamic-code guard keeps local shadowing scoped', () => {
  for (const source of [
    "{ const eval = sandbox.eval; eval('local') }\neval('global')",
    "function local(window) { window.eval('local') }\nwindow.eval('global')",
    "try {} catch (Function) { Function('local') }\nnew Function('global')",
    "{ const setTimeout = scheduler.setTimeout; setTimeout('local', 0) }\nsetTimeout('global', 0)",
  ]) {
    assert.ok(findDynamicCodeExecution(source), source)
  }
})

test('dynamic-code guard ignores inert text, callback timers and unrelated methods', () => {
  for (const source of [
    "// eval('example')",
    "const example = \"new Function('return 1')\"",
    "setTimeout(() => refresh(), 0)",
    "window.setInterval(() => refresh(), 1000)",
    "sandbox.eval('expression')",
    "factory.Function('template')",
    "const execute = sandbox.eval",
    "const Compiler = factory.Function",
    "const schedule = setTimeout",
    "const FunctionName = 'safe label'",
  ]) {
    assert.equal(findDynamicCodeExecution(source), null, source)
  }
})
