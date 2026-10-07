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
  const disabledCallableAliases = new Set()
  const namespaceAliases = new Set()
  const optionObjects = new Map()
  const permanentDisableValueAliases = new Set()

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

    const isConstBinding =
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0

    if (isConstBinding && ts.isIdentifier(node.name)) {
      if (isPermanentDisableValue(unwrappedInitializer)) {
        permanentDisableValueAliases.add(node.name.text)
      } else if (
        ts.isIdentifier(unwrappedInitializer) &&
        permanentDisableValueAliases.has(unwrappedInitializer.text)
      ) {
        permanentDisableValueAliases.add(node.name.text)
      }
    }

    if (
      isConstBinding &&
      ts.isIdentifier(node.name) &&
      ts.isIdentifier(unwrappedInitializer)
    ) {
      const aliasedOptions = optionObjects.get(unwrappedInitializer.text)
      if (aliasedOptions) optionObjects.set(node.name.text, aliasedOptions)
      if (callableAliases.has(unwrappedInitializer.text)) {
        callableAliases.add(node.name.text)
      }
      if (disabledCallableAliases.has(unwrappedInitializer.text)) {
        disabledCallableAliases.add(node.name.text)
      }
    }

    if (
      isConstBinding &&
      ts.isIdentifier(node.name) &&
      (ts.isPropertyAccessExpression(unwrappedInitializer) ||
        ts.isElementAccessExpression(unwrappedInitializer))
    ) {
      const base = unwrapExpression(unwrappedInitializer.expression)
      if (
        ts.isIdentifier(base) &&
        namespaceAliases.has(base.text) &&
        canonicalApiNames.has(memberName(unwrappedInitializer))
      ) {
        callableAliases.add(node.name.text)
      }

      if (
        disabledMemberNames.has(memberName(unwrappedInitializer)) &&
        base &&
        isTestCallableExpression(base, { callableAliases, namespaceAliases })
      ) {
        disabledCallableAliases.add(node.name.text)
      }
    }

    if (
      isConstBinding &&
      ts.isObjectBindingPattern(node.name) &&
      ts.isIdentifier(unwrappedInitializer) &&
      namespaceAliases.has(unwrappedInitializer.text)
    ) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue
        const sourceName = staticName(element.propertyName) ?? element.name.text
        addNamedBinding(sourceName, element.name.text)
      }
    }

    if (isConstBinding && ts.isObjectBindingPattern(node.name)) {
      const sourceIsTestCallable = isTestCallableExpression(
        unwrappedInitializer,
        { callableAliases, namespaceAliases },
      )

      if (sourceIsTestCallable) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const sourceName = staticName(element.propertyName) ?? element.name.text
          if (disabledMemberNames.has(sourceName)) {
            disabledCallableAliases.add(element.name.text)
          }
        }
      }
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
  return {
    callableAliases,
    disabledCallableAliases,
    namespaceAliases,
    optionObjects,
    permanentDisableValueAliases,
  }
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
  if (ts.isIdentifier(current)) {
    return bindings.disabledCallableAliases.has(current.text)
  }

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

function resolvesToPermanentDisableValue(node, bindings) {
  const value = unwrapExpression(node)
  if (isPermanentDisableValue(value)) return true
  return (
    ts.isIdentifier(value) &&
    bindings.permanentDisableValueAliases.has(value.text)
  )
}

function resolveFinalOption(options, optionName, bindings, visited = new Set()) {
  if (visited.has(options)) return { found: false, property: null }
  const nextVisited = new Set(visited)
  nextVisited.add(options)

  for (let index = options.properties.length - 1; index >= 0; index -= 1) {
    const property = options.properties[index]

    if (ts.isPropertyAssignment(property)) {
      const name = staticName(property.name)
      if (name === optionName) {
        return {
          found: true,
          property: resolvesToPermanentDisableValue(property.initializer, bindings)
            ? property
            : null,
        }
      }

      if (name === null) {
        return { found: true, property: null }
      }
      continue
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      if (property.name.text === optionName) {
        return {
          found: true,
          property: bindings.permanentDisableValueAliases.has(property.name.text)
            ? property
            : null,
        }
      }
      continue
    }

    if (ts.isSpreadAssignment(property)) {
      const spreadOptions = resolveOptionsObject(property.expression, bindings)
      if (!spreadOptions) return { found: true, property: null }

      const spreadResult = resolveFinalOption(
        spreadOptions,
        optionName,
        bindings,
        nextVisited,
      )
      if (spreadResult.found) return spreadResult
    }
  }

  return { found: false, property: null }
}

function findPermanentDisableProperty(options, bindings) {
  for (const optionName of disabledMemberNames) {
    const result = resolveFinalOption(options, optionName, bindings)
    if (result.property) return result.property
  }

  return null
}

function findPermanentDisableOption(call, bindings) {
  if (!isTestCallableExpression(call.expression, bindings)) return null

  for (const argument of call.arguments) {
    const options = resolveOptionsObject(argument, bindings)
    if (!options) continue

    const finding = findPermanentDisableProperty(options, bindings)
    if (finding) return finding
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

test('disabled-test guard follows local const aliases of known test callables', () => {
  for (const source of [
    "const check = test; check.skip('disabled', () => {})",
    "const primary = test; const check = primary; check.todo('disabled', () => {})",
    "import * as testApi from 'node:test'; const check = testApi.test; check.skip('disabled', () => {})",
    "const testApi = await import('node:test'); const group = testApi.describe; group.todo('disabled', () => {})",
    "import * as testApi from 'node:test'; const { test: check } = testApi; check.skip('disabled', () => {})",
    "const testApi = require('node:test'); const { suite: group } = testApi; group.todo('disabled', () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  for (const source of [
    "let check = test; check = helper; check.skip('unrelated helper', () => {})",
    "const helper = { skip() {} }; const check = helper; check.skip('unrelated helper', () => {})",
    "import * as testApi from 'node:test'; const helper = testApi.mock; helper.skip('unrelated helper', () => {})",
    "import * as testApi from 'node:test'; const { mock: helper } = testApi; helper.skip('unrelated helper', () => {})",
  ]) {
    assert.equal(findDisabledTest(source), null, source)
  }
})

test('disabled-test guard follows const aliases of disabled test members', () => {
  for (const source of [
    "const skipped = test.skip; skipped('disabled', () => {})",
    "const skipped = test.skip; const disabled = skipped; disabled('disabled', () => {})",
    "import * as testApi from 'node:test'; const skipped = testApi.test.skip; skipped('disabled', () => {})",
    "const testApi = await import('node:test'); const pending = testApi.describe.todo; pending('disabled', () => {})",
    "import { test as check } from 'node:test'; const skipped = check['skip']; skipped('disabled', () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  for (const source of [
    "let skipped = test.skip; skipped = helper; skipped('unrelated helper', () => {})",
    "const helper = { skip() {} }; const skipped = helper.skip; skipped('unrelated helper', () => {})",
    "import * as testApi from 'node:test'; const helper = testApi.mock; const skipped = helper.skip; skipped('unrelated helper', () => {})",
  ]) {
    assert.equal(findDisabledTest(source), null, source)
  }
})

test('disabled-test guard follows destructured disabled members from test callables', () => {
  for (const source of [
    "const { skip } = test; skip('disabled', () => {})",
    "const { todo: pending } = test; pending('disabled', () => {})",
    "import { test as check } from 'node:test'; const { skip: skipped } = check; skipped('disabled', () => {})",
    "import * as testApi from 'node:test'; const { todo: pending } = testApi.describe; pending('disabled', () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  for (const source of [
    "let { skip } = test; skip = helper; skip('unrelated helper', () => {})",
    "const helper = { skip() {} }; const { skip } = helper; skip('unrelated helper', () => {})",
    "import * as testApi from 'node:test'; const { skip } = testApi.mock; skip('unrelated helper', () => {})",
  ]) {
    assert.equal(findDisabledTest(source), null, source)
  }
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

  for (const source of [
    "const disabled = { skip: true }; test('case', {...disabled}, () => {})",
    "test('case', {...{todo: 'pending regression'}}, () => {})",
    "const disabled = { todo: true }; const options = {...disabled}; test('case', options, () => {})",
    "const disabled = { skip: true }; const options = disabled; test('case', options, () => {})",
    "const disabled = { todo: 'pending regression' }; const alias = disabled; const options = alias; test('case', options, () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  for (const source of [
    "const disabled = true; test('case', {skip: disabled}, () => {})",
    "const reason = 'pending regression'; test('case', {todo: reason}, () => {})",
    "const reason = 'pending regression'; const disabled = reason; test('case', {skip: disabled}, () => {})",
    "const skip = true; test('case', {skip}, () => {})",
    "const todo = 'pending regression'; test('case', {todo}, () => {})",
  ]) {
    assert.ok(findDisabledTest(source), source)
  }

  const emptyTemplate =
    "test('case', {todo: " + tick + tick + "}, () => {})"

  for (const source of [
    "test('case', {skip: false}, () => {})",
    "const disabled = false; test('case', {skip: disabled}, () => {})",
    "const skip = false; test('case', {skip}, () => {})",
    "const todo = ''; test('case', {todo}, () => {})",
    "let disabled = true; disabled = false; test('case', {skip: disabled}, () => {})",
    "const disabled = shouldSkip; test('case', {skip: disabled}, () => {})",
    "const disabled = {skip: true}; test('case', {...disabled, skip: false}, () => {})",
    "const disabled = {skip: true}; const enabled = {skip: false}; test('case', {...disabled, ...enabled}, () => {})",
    "const disabled = {skip: true}; const enabled = {...disabled, skip: false}; const options = enabled; test('case', options, () => {})",
    "const disabled = {skip: true}; let options = disabled; options = {skip: false}; test('case', options, () => {})",
    "const disabled = {skip: true}; test('case', {...disabled, ...runtimeOptions}, () => {})",
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
