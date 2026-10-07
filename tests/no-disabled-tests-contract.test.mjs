import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import * as ts from 'typescript'

const testsDir = new URL('./', import.meta.url)
const canonicalApiNames = new Set(['test', 'it', 'describe', 'suite'])
const disabledMemberNames = new Set(['skip', 'todo'])

function isNodeTestSpecifier(node) {
  return ts.isStringLiteralLike(node) && node.text === 'node:test'
}

function staticName(node) {
  if (!node) return null
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
  if (ts.isComputedPropertyName(node)) return staticName(node.expression)
  return null
}

function unwrapExpression(node) {
  let current = node
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}

function nodeTestBindingKind(initializer) {
  if (!initializer) return null
  const expression = unwrapExpression(initializer)
  if (!ts.isCallExpression(expression) || expression.arguments.length === 0) {
    return null
  }

  const [specifier] = expression.arguments
  if (!isNodeTestSpecifier(specifier)) return null

  if (expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return 'namespace'
  }

  if (ts.isIdentifier(expression.expression) && expression.expression.text === 'require') {
    return 'commonjs'
  }

  return null
}

function collectBindings(sourceFile) {
  const callableAliases = new Set(canonicalApiNames)
  const namespaceAliases = new Set()
  const optionObjects = new Map()

  function addNamedBinding(sourceName, localName) {
    if (
      canonicalApiNames.has(sourceName) &&
      typeof localName === 'string' &&
      localName.length > 0
    ) {
      callableAliases.add(localName)
    }
  }

  function collectVariableBinding(node) {
    if (!node.initializer) return

    const unwrappedInitializer = unwrapExpression(node.initializer)
    if (ts.isIdentifier(node.name) && ts.isObjectLiteralExpression(unwrappedInitializer)) {
      optionObjects.set(node.name.text, unwrappedInitializer)
    }

    const bindingKind = nodeTestBindingKind(node.initializer)
    if (!bindingKind) return

    if (ts.isIdentifier(node.name)) {
      namespaceAliases.add(node.name.text)
      if (bindingKind === 'commonjs') callableAliases.add(node.name.text)
      return
    }

    if (ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue
        const sourceName = staticName(element.propertyName) ?? element.name.text
        addNamedBinding(sourceName, element.name.text)
      }
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && isNodeTestSpecifier(node.moduleSpecifier)) {
      const clause = node.importClause
      if (clause?.name) callableAliases.add(clause.name.text)

      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaceAliases.add(bindings.name.text)
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const sourceName = element.propertyName?.text ?? element.name.text
          addNamedBinding(sourceName, element.name.text)
        }
      }
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      isNodeTestSpecifier(node.moduleReference.expression)
    ) {
      callableAliases.add(node.name.text)
      namespaceAliases.add(node.name.text)
    }

    if (ts.isVariableDeclaration(node)) collectVariableBinding(node)

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { callableAliases, namespaceAliases, optionObjects }
}

function memberName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  if (ts.isElementAccessExpression(expression)) {
    return staticName(expression.argumentExpression)
  }
  return null
}

function memberBase(expression) {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return expression.expression
  }
  return null
}

function isTestCallableExpression(expression, bindings) {
  const current = unwrapExpression(expression)

  if (ts.isIdentifier(current)) {
    return bindings.callableAliases.has(current.text)
  }

  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    const base = unwrapExpression(current.expression)
    return (
      ts.isIdentifier(base) &&
      bindings.namespaceAliases.has(base.text) &&
      canonicalApiNames.has(memberName(current))
    )
  }

  return false
}

function isDisabledTestCallee(expression, bindings) {
  const current = unwrapExpression(expression)
  if (!ts.isPropertyAccessExpression(current) && !ts.isElementAccessExpression(current)) {
    return false
  }

  const disabledMember = memberName(current)
  const base = memberBase(current)
  return (
    disabledMemberNames.has(disabledMember) &&
    base &&
    isTestCallableExpression(base, bindings)
  )
}

function isPermanentDisableValue(node) {
  const value = unwrapExpression(node)
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  return ts.isStringLiteralLike(value) && value.text.length > 0
}

function resolveOptionsObject(argument, bindings) {
  const value = unwrapExpression(argument)
  if (ts.isObjectLiteralExpression(value)) return value
  if (ts.isIdentifier(value)) return bindings.optionObjects.get(value.text) ?? null
  return null
}

function findPermanentDisableOption(call, bindings) {
  if (!isTestCallableExpression(call.expression, bindings)) return null

  for (const argument of call.arguments) {
    const options = resolveOptionsObject(argument, bindings)
    if (!options) continue

    for (const property of options.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const name = staticName(property.name)
      if (
        disabledMemberNames.has(name) &&
        isPermanentDisableValue(property.initializer)
      ) {
        return property
      }
    }
  }

  return null
}

function findDisabledTest(source) {
  const sourceFile = ts.createSourceFile(
    'candidate.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const bindings = collectBindings(sourceFile)
  let finding = null

  function visit(node) {
    if (finding) return

    if (ts.isCallExpression(node)) {
      if (isDisabledTestCallee(node.expression, bindings)) {
        finding = {
          kind: 'disabled member call',
          text: node.expression.getText(sourceFile),
        }
        return
      }

      const disabledOption = findPermanentDisableOption(node, bindings)
      if (disabledOption) {
        finding = {
          kind: 'literal disabled option',
          text: disabledOption.getText(sourceFile),
        }
        return
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return finding
}

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')
    const finding = findDisabledTest(source)

    assert.equal(
      finding,
      null,
      file + ' explicitly disables a regression with ' +
        (finding?.kind ?? 'unknown syntax') + ': ' +
        (finding?.text ?? 'unknown source'),
    )
  }
})

test('disabled-test guard rejects direct member calls including optional chains', () => {
  for (const source of [
    "test.skip('disabled', () => {})",
    "it['skip']('disabled', () => {})",
    'describe["todo"]("disabled", () => {})',
    "suite['skip']('disabled', () => {})",
    "test/* trivia */.skip('disabled', () => {})",
    "describe/* trivia */['todo']/* call */('disabled', () => {})",
    "test?.skip('disabled', () => {})",
    "it?.['todo']('disabled', () => {})",
    "describe.skip?.('disabled', () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  for (const source of [
    "test('enabled', () => {})",
    "it['runs']('enabled', () => {})",
    "describe[member]('dynamic', () => {})",
    "// test.skip('example only', () => {})",
    "const example = \"test.todo('example only')\"",
  ]) {
    assert.equal(findDisabledTest(source), null, source)
  }
})

test('disabled-test guard follows static, dynamic and CommonJS node:test aliases', () => {
  for (const source of [
    "import check from 'node:test'; check.skip('disabled', () => {})",
    "import { test as check, describe as group } from 'node:test'; group['todo']('disabled', () => {})",
    "import * as testApi from 'node:test'; testApi.test.skip('disabled', () => {})",
    "const { test: check } = await import('node:test'); check.skip('disabled', () => {})",
    "const testApi = await import('node:test'); testApi.suite['todo']('disabled', () => {})",
    "import { test as check } /* before from */ from/* source */'node:test'; check/* member */.skip('disabled', () => {})",
    "const testApi = await import/* call */('node:test'); testApi.test/* member */['todo']('disabled', () => {})",
    "const check = require('node:test'); check.skip('disabled', () => {})",
    "import check = require('node:test'); check.todo('disabled', () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  assert.equal(
    findDisabledTest(
      "import check from './helper.js'; check.skip('not a node:test API', () => {})",
    ),
    null,
  )
})

test('disabled-test guard rejects literal options only on test API calls', () => {
  const disabledOptions = [
    'skip: true',
    'todo: true',
    "skip: 'flaky regression'",
    'todo: "pending regression"',
    "'skip': true",
    '"todo": "pending regression"',
    "['skip']: true",
    '["todo"]: "pending regression"',
    "['skip'] /* key */ : /* value */ true",
  ]

  for (const option of disabledOptions) {
    const source = "test('case', {" + option + "}, () => {})"
    assert.ok(findDisabledTest(source), source)
  }

  const tick = String.fromCharCode(96)
  const templateReason =
    "test('case', {todo: " + tick + 'pending regression' + tick + "}, () => {})"
  assert.ok(findDisabledTest(templateReason), templateReason)

  const variableOptions =
    "const options = { skip: true }; test('case', options, () => {})"
  assert.ok(findDisabledTest(variableOptions), variableOptions)

  const emptyTemplate =
    "test('case', {todo: " + tick + tick + "}, () => {})"

  for (const source of [
    "test('case', {skip: false}, () => {})",
    "test('case', {skip: process.platform === 'win32'}, () => {})",
    "test('case', {todo: shouldSkip}, () => {})",
    "test('case', {skip: ''}, () => {})",
    emptyTemplate,
    "const unrelated = {skip: true}",
    "const example = \"test('case', {skip: true}, () => {})\"",
    "/* test('case', {todo: true}, () => {}) */",
  ]) {
    assert.equal(findDisabledTest(source), null, source)
  }
})
